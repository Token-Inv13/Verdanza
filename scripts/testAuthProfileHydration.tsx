import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";

type Write = { method: string; path: string; data: Record<string, unknown> };
type State = {
  loading: boolean;
  admin: boolean;
  user: boolean;
  userUid: string | null;
  adminUid: string | null;
  adminEmail: string | null;
  profile: Record<string, unknown> | null;
  profileUid: string | null;
};
const existingProfile = {
  uid: "auth-test-owner", email: "account@example.invalid", displayName: "Profil existant",
  phone: "0600000000", role: "customer", loyaltyPoints: 123, orderCount: 7, totalSpent: 80,
  createdAt: { seconds: 1 }, updatedAt: { seconds: 2 },
};

// Real AuthProvider, customer services, admin gate and profile form. Only the
// Firebase transport is substituted; every customer write is recorded.
const firestoreMock = `
  const options = new URLSearchParams(location.search);
  const user = { uid:"auth-test-owner",email:"account@example.invalid",displayName:"Nom Auth",
    phoneNumber:"",emailVerified:true,getIdToken:async()=>"synthetic-token" };
  const userB = { ...user, uid:"auth-test-other",email:"other@example.invalid",displayName:"Nom B" };
  const documents = new Map();
  if (!options.has("missing")) documents.set("customers/"+user.uid, ${JSON.stringify(existingProfile)});
  documents.set("customers/"+userB.uid, {...${JSON.stringify(existingProfile)},uid:userB.uid,email:userB.email,displayName:"Profil B"});
  if (options.has("legacy-admin")) documents.set("adminUsers/"+user.email, {email:user.email,isActive:true,role:"admin"});
  if (!options.has("not-admin") && !options.has("legacy-admin")) documents.set("adminUsers/"+user.uid, {email:options.has("bad-admin-email")?userB.email:user.email,
    uid:options.has("bad-admin-uid")?userB.uid:options.has("bad-admin-uid-empty")?"":undefined,isActive:true,role:"admin"});
  if (options.has("admin-b")) documents.set("adminUsers/"+userB.uid, {email:userB.email,uid:userB.uid,isActive:true,role:"admin"});
  window.__fixture = {user,userB,documents,reads:[],writes:[],authCalls:[],listeners:new Set(),
    holds:new Map(),heldById:new Map(),nextHoldId:0,currentUser:options.has("guest")?null:user};
  window.__emitAuth=async()=>{await Promise.all([...window.__fixture.listeners].map(listener=>listener(window.__fixture.currentUser)));};
  window.__holdNextRead=(path)=>{const fixture=window.__fixture;let release;
    const hold={id:++fixture.nextHoldId,path,started:false,promise:new Promise(resolve=>release=resolve),release:()=>release()};
    fixture.holds.set(path,hold);fixture.heldById.set(hold.id,hold);return hold.id;};
  window.__releaseHeldRead=(id)=>{const fixture=window.__fixture;fixture.heldById.get(id)?.release();fixture.heldById.delete(id);};
  window.__switchUser=(which)=>{const fixture=window.__fixture;fixture.currentUser=which==="A"?user:which==="B"?userB:null;
    fixture.latestAuthPromise=window.__emitAuth();return fixture.latestAuthPromise;};
  export const doc=(_db,collection,id)=>({path:collection+"/"+id,id});
  export const getDoc=async(ref)=>{const fixture=window.__fixture;fixture.reads.push(ref.path);
    const stored=documents.get(ref.path);const data=stored===undefined?undefined:structuredClone(stored);
    const hold=fixture.holds.get(ref.path);if(hold){fixture.holds.delete(ref.path);hold.started=true;await hold.promise;}
    return {id:ref.id,exists:()=>data!==undefined,data:()=>data===undefined?undefined:structuredClone(data)};};
  export const serverTimestamp=()=>({syntheticServerTimestamp:true});
  export const setDoc=async(ref,data,options)=>{window.__fixture.writes.push({method:"setDoc",path:ref.path,data:structuredClone(data)});
    documents.set(ref.path,options?.merge?{...documents.get(ref.path),...data}:structuredClone(data));};
  export const updateDoc=async(ref,data)=>{const fixture=window.__fixture;
    const hold=fixture.holds.get("update:"+ref.path);if(hold){fixture.holds.delete("update:"+ref.path);hold.started=true;await hold.promise;}
    if(!documents.has(ref.path))throw Error("missing document");
    window.__fixture.writes.push({method:"updateDoc",path:ref.path,data:structuredClone(data)});
    documents.set(ref.path,{...documents.get(ref.path),...data});};
  export const runTransaction=async(_db,run)=>{const pending=[];const result=await run({get:getDoc,
    set:(ref,data)=>pending.push({ref,data})});
    for(const {ref,data} of pending){window.__fixture.writes.push({method:"transaction.set",path:ref.path,data:structuredClone(data)});
      documents.set(ref.path,structuredClone(data));}return result;};
`;
const authMock = `
  import "firebase/firestore";
  const fixture=window.__fixture;
  const auth={get currentUser(){return fixture.currentUser;}};
  const authenticate=async(name)=>{fixture.authCalls.push(name);fixture.currentUser=fixture.user;
    fixture.latestAuthPromise=window.__emitAuth();return {user:fixture.user};};
  export const getFirebaseAuth=async()=>auth;
  export const loadFirebaseAuthApi=async()=>({auth,firebaseAuth:{
    onAuthStateChanged:(_auth,listener)=>{fixture.listeners.add(listener);Promise.resolve().then(()=>listener(fixture.currentUser));
      return ()=>fixture.listeners.delete(listener);},
    createUserWithEmailAndPassword:()=>authenticate("register"),
    updateProfile:async(user,data)=>{fixture.authCalls.push("updateAuthProfile");Object.assign(user,data);},
    signInWithEmailAndPassword:()=>authenticate("passwordLogin"),
    GoogleAuthProvider:class{},
    signInWithPopup:()=>authenticate("google"),
    getAdditionalUserInfo:()=>{const mode=new URLSearchParams(location.search).get("google");
      return mode==="unknown"?null:{isNewUser:mode==="new"};},
    signOut:async()=>{fixture.currentUser=null;fixture.latestAuthPromise=window.__emitAuth();},
    sendPasswordResetEmail:async()=>{throw Error("not exercised");}
  }});
`;
const bundle = await build({
  stdin: {
    loader: "tsx", resolveDir: process.cwd(), sourcefile: "auth-profile-fixture.tsx",
    contents: `
      import React from "react";import {createRoot} from "react-dom/client";
      import {BrowserRouter,Routes,Route,useNavigate} from "react-router-dom";
      import {AuthProvider,useAuth} from "./src/context/AuthContext";
      import {AdminAuthGate} from "./src/components/AdminAuthGate";
      import {AccountProfilePage} from "./src/pages/account/AccountProfilePage";
      import {createCustomerProfileIfMissing} from "./src/services/customersService";
      function Probe(){const auth=useAuth();const navigate=useNavigate();
        return <><output data-testid="auth-state">{JSON.stringify({loading:auth.isLoading,admin:auth.isAdmin,
          user:!!auth.user,userUid:auth.user?.uid??null,adminUid:auth.adminUser?.uid??null,
          adminEmail:auth.adminUser?.email??null,profile:auth.customerProfile,
          profileUid:auth.customerProfile?.uid??null})}</output>
          <button onClick={()=>navigate("/admin/commandes")}>Route admin commandes</button>
          <button onClick={()=>navigate("/admin/catalogue")}>Route admin catalogue</button>
          <button onClick={()=>navigate("/compte")}>Route compte</button>
          <button onClick={()=>navigate("/checkout")}>Route checkout</button>
          <button onClick={()=>auth.refreshCustomerProfile()}>Actualiser profil</button>
          <button onClick={()=>auth.refreshAdminUser()}>Actualiser admin</button>
          <button onClick={()=>auth.register("account@example.invalid","synthetic-password","Inscription volontaire")}>Inscrire email</button>
          <button onClick={()=>auth.signIn("account@example.invalid","synthetic-password")}>Connexion email</button>
          <button onClick={()=>auth.signInWithGoogle()}>Connexion Google</button>
          <button onClick={()=>auth.signOut()}>Deconnexion</button>
          <button onClick={async()=>{if(auth.user){await createCustomerProfileIfMissing(auth.user);await auth.refreshCustomerProfile();}}}>Creer profil explicite</button>
        </>;
      }
      createRoot(document.getElementById("root")).render(<BrowserRouter><AuthProvider><Probe/><Routes>
        <Route path="/admin" element={<AdminAuthGate/>}>
          <Route index element={<p>Admin autorise</p>}/>
          <Route path="*" element={<p>Admin autorise</p>}/>
        </Route>
        <Route path="/compte" element={<AccountProfilePage/>}/>
        <Route path="*" element={<p>Lecture publique</p>}/>
      </Routes></AuthProvider></BrowserRouter>);
    `,
  },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", logLevel: "silent",
  define: { "import.meta.env": "{}" },
  plugins: [{
    name: "synthetic-firebase-transport",
    setup(plugin) {
      plugin.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: "firestore", namespace: "auth-profile-mock" }));
      plugin.onLoad({ filter: /.*/, namespace: "auth-profile-mock" }, () => ({ contents: firestoreMock, loader: "js" }));
      plugin.onLoad({ filter: /[\\/]lib[\\/]firebase\.ts$/ }, () => ({ contents: "export const db={synthetic:true};export const isFirebaseConfigured=true;", loader: "ts" }));
      plugin.onLoad({ filter: /[\\/]lib[\\/]firebaseAuth\.ts$/ }, () => ({ contents: authMock, loader: "js" }));
    },
  }],
});

const browser = await chromium.launch({ headless: true });
let passed = 0;
async function state(page: Page): Promise<State> {
  return JSON.parse(await page.getByTestId("auth-state").innerText()) as State;
}
async function settled(page: Page) {
  await page.waitForFunction(() => {
    const node = document.querySelector('[data-testid="auth-state"]');
    return node && JSON.parse(node.textContent || "{}").loading === false;
  });
}
async function writes(page: Page): Promise<Write[]> {
  return page.evaluate(() => Reflect.get(window, "__fixture").writes);
}
async function reads(page: Page): Promise<string[]> {
  return page.evaluate(() => Reflect.get(window, "__fixture").reads);
}
async function storedProfile(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => Reflect.get(window, "__fixture").documents.get("customers/auth-test-owner") ?? null);
}
async function holdNextRead(page: Page, path: string): Promise<number> {
  return page.evaluate(pathValue => Reflect.get(window, "__holdNextRead")(pathValue), path);
}
async function waitForHeldRead(page: Page, id: number) {
  await page.waitForFunction(holdId => Reflect.get(window, "__fixture").heldById.get(holdId)?.started === true, id);
}
async function releaseHeldRead(page: Page, id: number) {
  await page.evaluate(holdId => Reflect.get(window, "__releaseHeldRead")(holdId), id);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function withPage(path: string, run: (page: Page) => Promise<void>) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [], unexpected: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:5199") {
      unexpected.push(url.origin + url.pathname); await route.abort(); return;
    }
    if (route.request().resourceType() === "document") {
      await route.fulfill({ contentType: "text/html", body: `<html><body><div id="root"></div><script>${bundle.outputFiles[0].text}</script></body></html>` });
    } else {
      await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
    }
  });
  try {
    await page.goto(`http://127.0.0.1:5199${path}`); await settled(page);
    await run(page);
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    passed++; console.log(`PASS Auth/profile ${path}`);
  } catch (error) {
    console.error({ path, state: await state(page), reads: await reads(page), writes: await writes(page), errors, unexpected });
    throw error;
  } finally { await context.close(); }
}

try {
  await withPage("/admin", async page => {
    await page.getByText("Admin autorise", { exact: true }).waitFor();
    assert.equal((await state(page)).admin, true);
    assert.equal((await state(page)).profile?.displayName, existingProfile.displayName);
    assert.ok((await reads(page)).includes("adminUsers/auth-test-owner"));
    assert.ok((await reads(page)).includes("customers/auth-test-owner"));
    assert.deepEqual(await writes(page), []);
  });
  await withPage("/admin/commandes", async page => {
    for (const button of ["Route admin catalogue", "Route admin commandes", "Actualiser admin"]) {
      const before = (await reads(page)).length;
      await page.getByRole("button", { name: button, exact: true }).click();
      await page.waitForFunction(count => Reflect.get(window, "__fixture").reads.length > count, before);
      await settled(page);
      assert.equal((await state(page)).admin, true);
      assert.deepEqual(await writes(page), []);
    }
  });
  await withPage("/compte", async page => {
    assert.deepEqual((await state(page)).profile, { id: "auth-test-owner", ...existingProfile });
    assert.deepEqual(await writes(page), []);
  });
  await withPage("/compte?missing", async page => {
    assert.equal((await state(page)).profile, null);
    assert.equal(await storedProfile(page), null);
    assert.deepEqual(await writes(page), []);
  });
  await withPage("/admin?missing", async page => {
    await page.getByText("Admin autorise", { exact: true }).waitFor();
    assert.equal((await state(page)).admin, true);
    assert.equal((await state(page)).profile, null);
    assert.deepEqual(await writes(page), []);
  });
  await withPage("/compte?refresh", async page => {
    const before = (await reads(page)).length;
    await page.getByRole("button", { name: "Actualiser profil", exact: true }).click();
    await page.waitForFunction(count => Reflect.get(window, "__fixture").reads.length > count, before);
    assert.deepEqual(await writes(page), []);
    assert.deepEqual(await storedProfile(page), existingProfile);
  });
  await withPage("/compte?edit", async page => {
    await page.getByLabel("Nom affiché", { exact: true }).fill("Modification volontaire");
    await page.getByLabel("Téléphone", { exact: true }).fill("0611111111");
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await page.getByText("Profil mis à jour.", { exact: true }).waitFor();
    assert.deepEqual(await writes(page), [{
      method: "updateDoc", path: "customers/auth-test-owner",
      data: { displayName: "Modification volontaire", phone: "0611111111", updatedAt: { syntheticServerTimestamp: true } },
    }]);
    assert.equal((await state(page)).profile?.displayName, "Modification volontaire");
    const before = (await reads(page)).length;
    await page.getByRole("button", { name: "Actualiser profil", exact: true }).click();
    await page.waitForFunction(count => Reflect.get(window, "__fixture").reads.length > count, before);
    assert.equal((await writes(page)).length, 1);
    assert.deepEqual(await storedProfile(page), { ...existingProfile, displayName: "Modification volontaire",
      phone: "0611111111", updatedAt: { syntheticServerTimestamp: true } });
  });
  await withPage("/compte?missing&edit", async page => {
    await page.getByLabel("Nom affiché", { exact: true }).fill("Creation volontaire");
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await page.getByText("Profil mis à jour.", { exact: true }).waitFor();
    assert.deepEqual((await writes(page)).map(write => write.method), ["transaction.set", "updateDoc"]);
    assert.equal((await state(page)).profile?.displayName, "Creation volontaire");
  });
  await withPage("/inscription?guest&missing", async page => {
    await page.getByRole("button", { name: "Inscrire email", exact: true }).click();
    await page.waitForFunction(() => Reflect.get(window, "__fixture").documents.has("customers/auth-test-owner"));
    assert.equal((await writes(page)).length, 1);
    assert.equal((await writes(page))[0].method, "transaction.set");
    const profile = await storedProfile(page);
    assert.equal(profile?.displayName, "Inscription volontaire");
    assert.equal(profile?.email, "account@example.invalid");
    assert.equal(profile?.loyaltyPoints, 0); assert.equal(profile?.orderCount, 0); assert.equal(profile?.totalSpent, 0);
    await page.getByRole("button", { name: "Route compte", exact: true }).click(); await settled(page);
    await page.getByLabel("Nom affiché", { exact: true }).waitFor();
    assert.equal((await state(page)).profile?.displayName, "Inscription volontaire");
    assert.equal((await writes(page)).length, 1);
  });
  await withPage("/connexion?guest", async page => {
    await page.getByRole("button", { name: "Connexion email", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="auth-state"]')!.textContent!).user);
    assert.deepEqual(await writes(page), []);
  });
  await withPage("/connexion?guest&missing", async page => {
    await page.getByRole("button", { name: "Connexion email", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="auth-state"]')!.textContent!).user);
    assert.equal((await state(page)).profile, null);
    assert.deepEqual(await writes(page), []);
  });
  await withPage("/connexion?guest&missing&google=new", async page => {
    await page.getByRole("button", { name: "Connexion Google", exact: true }).click();
    await page.waitForFunction(() => Reflect.get(window, "__fixture").documents.has("customers/auth-test-owner"));
    assert.equal((await writes(page)).length, 1);
    await page.evaluate(() => Reflect.get(window, "__emitAuth")());
    await page.getByRole("button", { name: "Route compte", exact: true }).click(); await settled(page);
    assert.equal((await writes(page)).length, 1);
  });
  for (const google of ["existing", "unknown"]) {
    await withPage(`/connexion?guest&missing&google=${google}`, async page => {
      await page.getByRole("button", { name: "Connexion Google", exact: true }).click();
      await page.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="auth-state"]')!.textContent!).user);
      assert.equal((await state(page)).profile, null);
      await page.evaluate(() => Reflect.get(window, "__emitAuth")());
      await page.getByRole("button", { name: "Route checkout", exact: true }).click(); await settled(page);
      assert.deepEqual(await writes(page), []);
    });
  }
  await withPage("/connexion?guest&google=existing", async page => {
    await page.getByRole("button", { name: "Connexion Google", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="auth-state"]')!.textContent!).profile !== null);
    assert.deepEqual(await storedProfile(page), existingProfile);
    assert.deepEqual(await writes(page), []);
  });
  for (const path of ["/checkout?missing", "/blog/article-fictif?missing"]) {
    await withPage(path, async page => {
      assert.equal((await state(page)).profile, null);
      await page.evaluate(() => Reflect.get(window, "__emitAuth")());
      assert.deepEqual(await writes(page), []);
    });
  }
  await withPage("/compte?preserve", async page => {
    await page.getByRole("button", { name: "Creer profil explicite", exact: true }).click();
    const before = (await reads(page)).length;
    await page.getByRole("button", { name: "Actualiser profil", exact: true }).click();
    await page.waitForFunction(count => Reflect.get(window, "__fixture").reads.length > count, before);
    assert.deepEqual(await storedProfile(page), existingProfile);
    assert.deepEqual(await writes(page), []);
  });
  await withPage("/compte?logout", async page => {
    await page.getByRole("button", { name: "Deconnexion", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="auth-state"]')!.textContent!).user === false);
    assert.equal((await state(page)).profile, null); assert.equal((await state(page)).admin, false);
    assert.deepEqual(await writes(page), []);
  });
  for (const flow of ["email", "google"]) {
    const path = flow === "email" ? "/inscription?guest&missing&race=email" : "/connexion?guest&missing&google=new&race=google";
    await withPage(path, async page => {
      const held = await holdNextRead(page, "adminUsers/auth-test-owner");
      await page.getByRole("button", { name: flow === "email" ? "Inscrire email" : "Connexion Google", exact: true }).click();
      await waitForHeldRead(page, held);
      await page.waitForFunction(() => {
        const fixture = Reflect.get(window, "__fixture");
        const state = JSON.parse(document.querySelector('[data-testid="auth-state"]')?.textContent || "{}");
        return fixture.documents.has("customers/auth-test-owner") && state.profile?.uid === "auth-test-owner";
      });
      assert.equal((await writes(page)).length, 1);
      await releaseHeldRead(page, held);
      assert.equal((await state(page)).profileUid, "auth-test-owner", `${flow}: stale null must not overwrite explicit creation`);
      assert.equal((await state(page)).loading, false);
      assert.deepEqual((await writes(page)).map(write => write.method), ["transaction.set"]);
    });
  }
  await withPage("/compte?profile-revisions", async page => {
    const oldRead = await holdNextRead(page, "customers/auth-test-owner");
    await page.getByRole("button", { name: "Actualiser profil", exact: true }).click();
    await waitForHeldRead(page, oldRead);
    await page.evaluate(() => {
      const fixture = Reflect.get(window, "__fixture");
      const previous = fixture.documents.get("customers/auth-test-owner");
      fixture.documents.set("customers/auth-test-owner", { ...previous, displayName: "Profil B" });
    });
    await page.getByRole("button", { name: "Actualiser profil", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="auth-state"]')?.textContent || "{}").profile?.displayName === "Profil B");
    await releaseHeldRead(page, oldRead);
    assert.equal((await state(page)).profile?.displayName, "Profil B");
    assert.deepEqual(await writes(page), []);
  });
  await withPage("/compte?missing&concurrent-create", async page => {
    const oldRead = await holdNextRead(page, "customers/auth-test-owner");
    await page.getByRole("button", { name: "Actualiser profil", exact: true }).click();
    await waitForHeldRead(page, oldRead);
    await page.getByRole("button", { name: "Creer profil explicite", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="auth-state"]')?.textContent || "{}").profileUid === "auth-test-owner");
    await releaseHeldRead(page, oldRead);
    assert.equal((await state(page)).profileUid, "auth-test-owner");
    assert.deepEqual((await writes(page)).map(write => write.method), ["transaction.set"]);
  });
  await withPage("/compte?edit-race", async page => {
    const oldRead = await holdNextRead(page, "customers/auth-test-owner");
    await page.getByRole("button", { name: "Actualiser profil", exact: true }).click();
    await waitForHeldRead(page, oldRead);
    await page.getByLabel("Nom affiché", { exact: true }).fill("Edition plus récente");
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await page.getByText("Profil mis à jour.", { exact: true }).waitFor();
    await releaseHeldRead(page, oldRead);
    assert.equal((await state(page)).profile?.displayName, "Edition plus récente");
    assert.deepEqual((await writes(page)).map(write => write.method), ["updateDoc"]);
    assert.equal((await storedProfile(page))?.loyaltyPoints, 123);
    assert.equal((await storedProfile(page))?.orderCount, 7);
  });
  await withPage("/compte?edit-observer-race", async page => {
    const heldWrite = await holdNextRead(page, "update:customers/auth-test-owner");
    await page.getByLabel("Nom affiché", { exact: true }).fill("Sauvegarde prioritaire");
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await waitForHeldRead(page, heldWrite);
    const oldRead = await holdNextRead(page, "customers/auth-test-owner");
    await page.evaluate(() => { Reflect.set(window, "__oldAuthPromise", Reflect.get(window, "__emitAuth")()); });
    await waitForHeldRead(page, oldRead);
    await releaseHeldRead(page, heldWrite);
    await page.getByText("Profil mis à jour.", { exact: true }).waitFor();
    await releaseHeldRead(page, oldRead);
    await page.evaluate(() => Reflect.get(window, "__oldAuthPromise"));
    assert.equal((await state(page)).profile?.displayName, "Sauvegarde prioritaire");
    assert.equal((await writes(page)).length, 1);
    assert.equal((await storedProfile(page))?.displayName, "Sauvegarde prioritaire");
  });  await withPage("/compte?logout-race", async page => {
    const oldRead = await holdNextRead(page, "customers/auth-test-owner");
    await page.getByRole("button", { name: "Actualiser profil", exact: true }).click();
    await waitForHeldRead(page, oldRead);
    await page.getByRole("button", { name: "Deconnexion", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="auth-state"]')?.textContent || "{}").userUid === null);
    await releaseHeldRead(page, oldRead);
    assert.equal((await state(page)).profile, null);
    assert.equal((await state(page)).admin, false);
    assert.deepEqual(await writes(page), []);
  });
  await withPage("/compte?uid-switch-profile", async page => {
    const oldRead = await holdNextRead(page, "customers/auth-test-owner");
    await page.evaluate(() => { Reflect.set(window, "__oldAuthPromise", Reflect.get(window, "__emitAuth")()); });
    await waitForHeldRead(page, oldRead);
    await page.evaluate(() => Reflect.get(window, "__switchUser")("B"));
    await releaseHeldRead(page, oldRead);
    await page.evaluate(() => Reflect.get(window, "__oldAuthPromise"));
    assert.equal((await state(page)).userUid, "auth-test-other");
    assert.equal((await state(page)).profileUid, "auth-test-other");
    assert.equal((await state(page)).admin, false);
    assert.equal((await state(page)).loading, false);
    assert.deepEqual(await writes(page), []);
  });
  for (const adminB of [false, true]) {
    await withPage(adminB ? "/compte?admin-b&uid-switch-admin" : "/compte?uid-switch-admin", async page => {
      const oldRead = await holdNextRead(page, "adminUsers/auth-test-owner");
      await page.evaluate(() => { Reflect.set(window, "__oldAuthPromise", Reflect.get(window, "__emitAuth")()); });
      await waitForHeldRead(page, oldRead);
      await page.evaluate(() => Reflect.get(window, "__switchUser")("B"));
      await releaseHeldRead(page, oldRead);
      await page.evaluate(() => Reflect.get(window, "__oldAuthPromise"));
      assert.equal((await state(page)).userUid, "auth-test-other");
      assert.equal((await state(page)).admin, adminB);
      assert.equal((await state(page)).adminUid, adminB ? "auth-test-other" : null);
      assert.equal((await state(page)).profileUid, "auth-test-other");
      assert.equal((await state(page)).loading, false);
      assert.deepEqual(await writes(page), []);
    });
  }
  await withPage("/compte?uid-switch-loading", async page => {
    const oldA = await holdNextRead(page, "adminUsers/auth-test-owner");
    const currentB = await holdNextRead(page, "adminUsers/auth-test-other");
    await page.evaluate(() => { Reflect.set(window, "__oldAuthPromise", Reflect.get(window, "__emitAuth")()); });
    await waitForHeldRead(page, oldA);
    await page.evaluate(() => { Reflect.set(window, "__newAuthPromise", Reflect.get(window, "__switchUser")("B")); });
    await waitForHeldRead(page, currentB);
    await releaseHeldRead(page, oldA);
    await page.evaluate(() => Reflect.get(window, "__oldAuthPromise"));
    assert.equal((await state(page)).userUid, "auth-test-other");
    assert.equal((await state(page)).loading, true);
    assert.equal((await state(page)).admin, false);
    await releaseHeldRead(page, currentB);
    await page.evaluate(() => Reflect.get(window, "__newAuthPromise"));
    assert.equal((await state(page)).loading, false);
    assert.deepEqual(await writes(page), []);
  });
  await withPage("/compte?admin-logout-race", async page => {
    const oldA = await holdNextRead(page, "adminUsers/auth-test-owner");
    await page.evaluate(() => { Reflect.set(window, "__oldAuthPromise", Reflect.get(window, "__emitAuth")()); });
    await waitForHeldRead(page, oldA);
    await page.evaluate(() => Reflect.get(window, "__switchUser")(null));
    await releaseHeldRead(page, oldA);
    await page.evaluate(() => Reflect.get(window, "__oldAuthPromise"));
    assert.equal((await state(page)).userUid, null);
    assert.equal((await state(page)).admin, false);
    assert.equal((await state(page)).adminUid, null);
    assert.equal((await state(page)).profile, null);
    assert.deepEqual(await writes(page), []);
  });
  await withPage("/compte?refresh-admin-race", async page => {
    const oldRead = await holdNextRead(page, "adminUsers/auth-test-owner");
    await page.getByRole("button", { name: "Actualiser admin", exact: true }).click();
    await waitForHeldRead(page, oldRead);
    await page.evaluate(() => Reflect.get(window, "__switchUser")("B"));
    await releaseHeldRead(page, oldRead);
    assert.equal((await state(page)).userUid, "auth-test-other");
    assert.equal((await state(page)).admin, false);
    assert.equal((await state(page)).adminUid, null);
    assert.deepEqual(await writes(page), []);
  });
  await withPage("/compte?refresh-customer-race", async page => {
    const oldRead = await holdNextRead(page, "customers/auth-test-owner");
    await page.getByRole("button", { name: "Actualiser profil", exact: true }).click();
    await waitForHeldRead(page, oldRead);
    await page.evaluate(() => Reflect.get(window, "__switchUser")("B"));
    await releaseHeldRead(page, oldRead);
    assert.equal((await state(page)).userUid, "auth-test-other");
    assert.equal((await state(page)).profileUid, "auth-test-other");
    assert.deepEqual(await writes(page), []);
  });
  await withPage("/compte?legacy-admin", async page => {
    assert.equal((await state(page)).admin, true);
    assert.equal((await state(page)).adminUid, null);
    assert.ok((await reads(page)).includes("adminUsers/account@example.invalid"));
    assert.deepEqual(await writes(page), []);
  });  for (const binding of ["bad-admin-email", "bad-admin-uid", "bad-admin-uid-empty"]) {
    await withPage(`/compte?${binding}`, async page => {
      assert.equal((await state(page)).userUid, "auth-test-owner");
      assert.equal((await state(page)).admin, false);
      assert.deepEqual(await writes(page), []);
    });
  }  console.log(`Auth/profile hydration: ${passed} PASS; synthetic Firebase only; no external traffic.`);
} finally { await browser.close(); }
