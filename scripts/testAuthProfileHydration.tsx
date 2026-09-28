import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";

type Write = { method: string; path: string; data: Record<string, unknown> };
type State = {
  loading: boolean;
  admin: boolean;
  user: boolean;
  profile: Record<string, unknown> | null;
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
  const documents = new Map();
  if (!options.has("missing")) documents.set("customers/"+user.uid, ${JSON.stringify(existingProfile)});
  if (!options.has("not-admin")) documents.set("adminUsers/"+user.uid, {email:user.email,isActive:true,role:"admin"});
  window.__fixture = {user,documents,reads:[],writes:[],authCalls:[],listeners:new Set(),
    currentUser:options.has("guest")?null:user};
  window.__emitAuth=async()=>{await Promise.all([...window.__fixture.listeners].map(listener=>listener(window.__fixture.currentUser)));};
  export const doc=(_db,collection,id)=>({path:collection+"/"+id,id});
  export const getDoc=async(ref)=>{window.__fixture.reads.push(ref.path);const data=documents.get(ref.path);
    return {id:ref.id,exists:()=>data!==undefined,data:()=>data===undefined?undefined:structuredClone(data)};};
  export const serverTimestamp=()=>({syntheticServerTimestamp:true});
  export const setDoc=async(ref,data,options)=>{window.__fixture.writes.push({method:"setDoc",path:ref.path,data:structuredClone(data)});
    documents.set(ref.path,options?.merge?{...documents.get(ref.path),...data}:structuredClone(data));};
  export const updateDoc=async(ref,data)=>{if(!documents.has(ref.path))throw Error("missing document");
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
    await window.__emitAuth();return {user:fixture.user};};
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
    signOut:async()=>{fixture.currentUser=null;await window.__emitAuth();},
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
        return <><output data-testid="auth-state">{JSON.stringify({loading:auth.isLoading,admin:auth.isAdmin,user:!!auth.user,profile:auth.customerProfile})}</output>
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
  console.log(`Auth/profile hydration: ${passed} PASS; synthetic Firebase only; no external traffic.`);
} finally { await browser.close(); }
