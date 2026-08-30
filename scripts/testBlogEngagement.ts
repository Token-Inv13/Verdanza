import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cleanCommentText,
  createPendingComment,
  getBlogEngagementSummary,
  listApprovedComments,
  moderateComment,
  toggleArticleLike,
} from "../api/_server/blogInteractions.js";
import { publishedBlogArticleSlugs } from "../src/data/blogArticleSlugs.js";

type StoredDocument = Record<string, unknown>;

class FakeSnapshot {
  constructor(
    readonly id: string,
    private readonly value?: StoredDocument,
  ) {}

  get exists() {
    return Boolean(this.value);
  }

  data() {
    return this.value;
  }
}

class FakeDocumentReference {
  constructor(
    private readonly database: FakeFirestore,
    readonly path: string,
  ) {}

  get id() {
    return this.path.split("/").at(-1) || "";
  }

  async get() {
    return this.database.snapshot(this);
  }

  async set(value: StoredDocument) {
    this.database.applySet(this, value, true);
  }
}

class FakeQuery {
  private queryLimit = 500;

  constructor(
    private readonly database: FakeFirestore,
    private readonly collectionName: string,
    private readonly filters: Array<{ field: string; value: unknown }> = [],
  ) {}

  where(field: string, operator: string, value: unknown) {
    assert.equal(operator, "==");
    return new FakeQuery(this.database, this.collectionName, [...this.filters, { field, value }]);
  }

  limit(limit: number) {
    this.queryLimit = limit;
    return this;
  }

  async get() {
    const prefix = `${this.collectionName}/`;
    const docs = [...this.database.documents.entries()]
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, value]) => new FakeSnapshot(path.slice(prefix.length), value))
      .filter((snapshot) =>
        this.filters.every((filter) => snapshot.data()?.[filter.field] === filter.value),
      )
      .slice(0, this.queryLimit);
    return { docs, empty: docs.length === 0 };
  }
}

class FakeCollectionReference extends FakeQuery {
  constructor(
    private readonly databaseRef: FakeFirestore,
    private readonly name: string,
  ) {
    super(databaseRef, name);
  }

  doc(id?: string) {
    return new FakeDocumentReference(
      this.databaseRef,
      `${this.name}/${id || `generated-${this.databaseRef.nextId()}`}`,
    );
  }
}

class FakeTransaction {
  private readonly writes: Array<{
    type: "set" | "update" | "delete";
    ref: FakeDocumentReference;
    value?: StoredDocument;
  }> = [];

  constructor(private readonly database: FakeFirestore) {}

  get(ref: FakeDocumentReference) {
    return Promise.resolve(this.database.snapshot(ref));
  }

  set(ref: FakeDocumentReference, value: StoredDocument) {
    this.writes.push({ type: "set", ref, value });
  }

  update(ref: FakeDocumentReference, value: StoredDocument) {
    this.writes.push({ type: "update", ref, value });
  }

  delete(ref: FakeDocumentReference) {
    this.writes.push({ type: "delete", ref });
  }

  commit() {
    for (const write of this.writes) {
      if (write.type === "delete") this.database.documents.delete(write.ref.path);
      else if (write.value) this.database.applySet(write.ref, write.value, write.type === "update");
    }
  }
}

class FakeFirestore {
  readonly documents = new Map<string, StoredDocument>();
  private sequence = 0;
  private transactionLock: Promise<void> = Promise.resolve();

  collection(name: string) {
    return new FakeCollectionReference(this, name);
  }

  async runTransaction<T>(callback: (transaction: FakeTransaction) => Promise<T>) {
    const previous = this.transactionLock;
    let release = () => {};
    this.transactionLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const transaction = new FakeTransaction(this);
    try {
      const result = await callback(transaction);
      transaction.commit();
      return result;
    } finally {
      release();
    }
  }

  nextId() {
    this.sequence += 1;
    return String(this.sequence).padStart(4, "0");
  }

  snapshot(ref: FakeDocumentReference) {
    return new FakeSnapshot(ref.id, this.documents.get(ref.path));
  }

  applySet(ref: FakeDocumentReference, value: StoredDocument, merge = false) {
    this.documents.set(ref.path, {
      ...(merge ? this.documents.get(ref.path) : {}),
      ...value,
    });
  }
}

const tests: Array<{ name: string; run: () => void | Promise<void> }> = [];
const secret = "blog-engagement-test-secret-with-more-than-thirty-two-characters";
const slug = publishedBlogArticleSlugs[0];
const browserId = "00000000-0000-4000-8000-000000000001";
process.env.RATE_LIMIT_HMAC_SECRET = secret;

function test(name: string, run: () => void | Promise<void>) {
  tests.push({ name, run });
}

function firestore() {
  return new FakeFirestore() as unknown as FirebaseFirestore.Firestore;
}

test("ajout et retrait d'un J'aime basculent l'etat et le compteur", async () => {
  const db = firestore();
  const added = await toggleArticleLike(db, slug, browserId);
  const removed = await toggleArticleLike(db, slug, browserId);
  assert.equal(added.viewerLiked, true);
  assert.equal(added.likeCount, 1);
  assert.equal(removed.viewerLiked, false);
  assert.equal(removed.likeCount, 0);
});

test("un double clic concurrent ne rend jamais le compteur negatif", async () => {
  const db = firestore();
  await Promise.all([
    toggleArticleLike(db, slug, browserId),
    toggleArticleLike(db, slug, browserId),
  ]);
  const summary = await getBlogEngagementSummary(db, { slug, browserId });
  assert.ok(summary.likeCount >= 0);
  assert.equal(summary.viewerLiked, false);
});

test("un J'aime actif maximum par navigateur et par article", async () => {
  const db = firestore();
  await toggleArticleLike(db, slug, browserId);
  const summary = await getBlogEngagementSummary(db, { slug, browserId });
  assert.equal(summary.viewerLiked, true);
  assert.equal(summary.likeCount, 1);
});

test("l'identifiant navigateur n'est pas stocke brut", async () => {
  const raw = new FakeFirestore();
  const db = raw as unknown as FirebaseFirestore.Firestore;
  await toggleArticleLike(db, slug, browserId);
  assert.equal(JSON.stringify([...raw.documents.values()]).includes(browserId), false);
});

test("la validation refuse un slug inconnu", async () => {
  await assert.rejects(
    () => toggleArticleLike(firestore(), "article-inconnu", browserId),
    /Guide introuvable/,
  );
});

test("un visiteur non connecte est bloque par la route commentaire", () => {
  const source = readFileSync("api/_server/blogInteractions.ts", "utf8");
  assert.match(source, /Connectez-vous pour commenter/);
  assert.match(source, /verifyFirebaseIdToken\(token\)/);
});

test("un utilisateur connecte peut envoyer un commentaire pending", async () => {
  const db = firestore();
  const comment = await createPendingComment(db, {
    slug,
    userId: "user-123",
    displayName: "Camille",
    text: "Merci pour ce guide clair.",
  });
  assert.equal(comment.status, "pending");
  assert.equal(comment.displayName, "Camille");
});

test("le HTML est neutralise dans les commentaires", () => {
  assert.equal(cleanCommentText("<b>Merci pour ce guide</b>"), "&lt;b&gt;Merci pour ce guide&lt;/b&gt;");
});

test("les longueurs minimale et maximale sont appliquees", () => {
  assert.throws(() => cleanCommentText("court"), /trop court/);
  assert.throws(() => cleanCommentText("x".repeat(1_001)), /trop long/);
});

test("un commentaire pending est invisible publiquement", async () => {
  const db = firestore();
  await createPendingComment(db, {
    slug,
    userId: "user-456",
    displayName: "Noa",
    text: "Commentaire en attente.",
  });
  const comments = await listApprovedComments(db, { slug });
  assert.equal(comments.total, 0);
});

test("un commentaire approved devient visible et comptabilise", async () => {
  const db = firestore();
  const comment = await createPendingComment(db, {
    slug,
    userId: "user-789",
    displayName: "Lou",
    text: "Commentaire utile et publiable.",
  });
  await moderateComment(db, {
    commentId: comment.id,
    status: "approved",
    actorId: "admin@example.test",
  });
  const comments = await listApprovedComments(db, { slug });
  const summary = await getBlogEngagementSummary(db, { slug, browserId });
  assert.equal(comments.total, 1);
  assert.equal(comments.comments[0].displayName, "Lou");
  assert.equal(summary.approvedCommentCount, 1);
});

test("rejeter un commentaire approuve decremente sans compteur negatif", async () => {
  const db = firestore();
  const comment = await createPendingComment(db, {
    slug,
    userId: "user-999",
    displayName: "Sam",
    text: "Commentaire a reclasser.",
  });
  await moderateComment(db, { commentId: comment.id, status: "approved", actorId: "admin" });
  await moderateComment(db, { commentId: comment.id, status: "rejected", actorId: "admin" });
  await moderateComment(db, { commentId: comment.id, status: "rejected", actorId: "admin" });
  const summary = await getBlogEngagementSummary(db, { slug, browserId });
  assert.equal(summary.approvedCommentCount, 0);
});

test("l'acces administrateur est protege par token et adminUsers", () => {
  const source = readFileSync("api/_server/blogInteractions.ts", "utf8");
  assert.match(source, /Token admin requis/);
  assert.match(source, /assertAdminUser\(db, token\)/);
});

test("le partage conserve le partage natif et les deux fallbacks de copie", () => {
  const source = readFileSync("src/components/BlogEngagement.tsx", "utf8");
  assert.match(source, /navigator\.share/);
  assert.match(source, /navigator\.clipboard\?\.writeText/);
  assert.match(source, /document\.execCommand\("copy"\)/);
  assert.match(source, /absoluteUrl\(blogArticlePath\(article\)\)/);
});

test("la barre d'actions et les commentaires partagent un seul etat par guide", () => {
  const source = readFileSync("src/pages/BlogArticlePage.tsx", "utf8");
  assert.equal((source.match(/<BlogEngagementProvider article=\{article\}>/g) || []).length, 1);
  assert.equal((source.match(/<BlogComments \/>/g) || []).length, 1);
  assert.match(source, /<BlogEngagementActions layout="horizontal" \/>/);
  assert.match(source, /<BlogEngagementActions layout="vertical" \/>/);
});

test("le bouton Commentaires cible la section publique", () => {
  const source = readFileSync("src/components/BlogEngagement.tsx", "utf8");
  assert.match(source, /document\.getElementById\(blogCommentsSectionId\)/);
  assert.match(source, /scrollIntoView/);
  assert.match(source, /id=\{blogCommentsSectionId\}/);
});

test("le formulaire est replie par defaut et peut etre ouvert puis annule", () => {
  const source = readFileSync("src/components/BlogEngagement.tsx", "utf8");
  assert.match(source, /useState\(false\)/);
  assert.match(source, /aria-expanded=\{isFormOpen\}/);
  assert.match(source, /isFormOpen && \(/);
  assert.match(source, /Écrire un commentaire/);
  assert.match(source, /Annuler/);
  assert.match(source, /setIsFormOpen\(false\)/);
});

test("les CTA commentaire distinguent les utilisateurs connectes et deconnectes", () => {
  const source = readFileSync("src/components/BlogEngagement.tsx", "utf8");
  assert.match(source, /Se connecter pour commenter/);
  assert.match(source, /Vous commentez en tant que/);
  assert.match(source, /Envoyer pour validation/);
  assert.match(source, /window\.location\.search/);
  assert.match(source, /window\.location\.hash/);
});

test("le menu de partage propose les destinations desktop et se ferme avec Escape", () => {
  const source = readFileSync("src/components/BlogEngagement.tsx", "utf8");
  assert.match(source, /role="menu"/);
  assert.match(source, /event\.key !== "Escape"/);
  assert.match(source, /wa\.me/);
  assert.match(source, /facebook\.com\/sharer/);
  assert.match(source, /x\.com\/intent\/post/);
  assert.match(source, /Lien copié/);
});

test("l'etat vide reste compact et le libelle interne n'est plus public", () => {
  const source = readFileSync("src/components/BlogEngagement.tsx", "utf8");
  assert.match(source, /data-blog-comments-empty/);
  assert.match(source, /Aucun commentaire pour le moment/);
  assert.doesNotMatch(source, /Commentaires approuvés/);
  assert.doesNotMatch(source, /Votre avis sur ce guide/);
});

test("les regles Firestore interdisent les collections blog au client", () => {
  const rules = readFileSync("firestore.rules", "utf8");
  assert.match(rules, /match \/blogArticleStats\/\{statId\}/);
  assert.match(rules, /match \/blogArticleLikes\/\{likeId\}/);
  assert.match(rules, /match \/blogArticleComments\/\{commentId\}/);
});

let passed = 0;
for (const entry of tests) {
  await entry.run();
  passed += 1;
  console.info(`PASS ${entry.name}`);
}
console.info(`Blog engagement: ${passed}/${tests.length} tests passed.`);
