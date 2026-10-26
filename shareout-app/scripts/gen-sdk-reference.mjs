#!/usr/bin/env node
/**
 * Generates src/data/agent/sdk-reference.generated.ts — the SDK reference the in-product
 * build agent ("Create with AI") and the owner chat are prompted with — from the SDK's
 * own types (sdk/src, the same source tsup emits dist/index.d.ts from).
 *
 * Why the TypeScript checker over sdk/src rather than dist/index.d.ts or the skill
 * markdown: it is the exact surface artifacts get, it needs no SDK build (so it does not
 * depend on how the bundle is built or staged), and the skill markdown is prose that can
 * drift from the code just like the hand-written block this replaces.
 *
 * Output:
 *   SDK_SURFACE   — every public `sdk.<member>` → the members of its type (tests check
 *                   prompt mentions against it).
 *   SDK_REFERENCE — compact signatures for the namespaces in PROMPT_MEMBERS.
 *
 * check:bundles regenerates this and fails when the committed copy is stale.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, sep } from 'node:path';
import ts from 'typescript';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const sdkSrc = join(appRoot, 'sdk', 'src');
const outFile = join(appRoot, 'src', 'data', 'agent', 'sdk-reference.generated.ts');

// What a generated page plausibly needs. Everything else stays in SDK_SURFACE (so the
// prompt may still name it) but out of the prompt, which is paid for on every build.
const PROMPT_MEMBERS = ['json', 'table', 'realtime', 'blobs', 'email', 'agent', 'me'];
const STATICS = ['create', 'ready'];

const program = ts.createProgram([join(sdkSrc, 'index.ts')], {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'],
  strict: true,
  skipLibCheck: true,
  noEmit: true,
});
const checker = program.getTypeChecker();

const fromSdk = (decl) => decl.getSourceFile().fileName.split('/').join(sep).startsWith(sdkSrc);
const isPublic = (decl) => {
  const mods = ts.getCombinedModifierFlags(decl);
  return !(mods & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) && !ts.isPrivateIdentifier(decl.name);
};

function unwrap(type) {
  const name = type.getSymbol()?.getName();
  if (name === 'Promise') {
    const [inner] = checker.getTypeArguments(type);
    if (inner) return unwrap(inner);
  }
  return checker.getNonNullableType(type);
}

/** Public, non-underscore methods and getters declared in sdk/src for a type. */
function members(type) {
  const out = [];
  for (const prop of checker.getPropertiesOfType(type)) {
    const decl = prop.valueDeclaration ?? prop.declarations?.[0];
    if (!decl || !fromSdk(decl) || prop.getName().startsWith('_')) continue;
    if ((ts.isClassElement(decl) || ts.isParameter(decl)) && !isPublic(decl)) continue;
    const t = checker.getTypeOfSymbolAtLocation(prop, decl);
    const sig = t.getCallSignatures()[0];
    out.push({ name: prop.getName(), sig, type: t });
  }
  return out;
}

function hasMethods(type) {
  return members(type).some((m) => m.sig);
}

function renderParam(p) {
  const decl = p.valueDeclaration;
  const optional = decl && (decl.questionToken || decl.initializer);
  if (decl && ts.isObjectBindingPattern(decl.name)) return '{…}';
  const t = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(p, decl));
  // Spell out only literal shapes and plain named interfaces — not Filter<T>/Partial<T>,
  // whose expansion against the default `{ id }` would mislead.
  const node = decl?.type && ts.isUnionTypeNode(decl.type)
    ? decl.type.types.find((n) => n.kind !== ts.SyntaxKind.UndefinedKeyword && n.kind !== ts.SyntaxKind.NullKeyword)
    : decl?.type;
  const literalShape = node && (ts.isTypeLiteralNode(node) || (ts.isTypeReferenceNode(node) && !node.typeArguments));
  const props = literalShape && (t.isClassOrInterface() || t.getSymbol()?.getName() === '__type')
    ? checker.getPropertiesOfType(t).filter((x) => !x.getName().startsWith('_'))
    : [];
  const isPlainObject = props.length > 0 && !t.getCallSignatures().length && !checker.isArrayType(t)
    && !['File', 'Blob', 'Uint8Array', 'HTMLElement', 'Element'].includes(t.getSymbol()?.getName());
  const name = isPlainObject
    ? `{${props.slice(0, 6).map((x) => x.getName() + (x.flags & ts.SymbolFlags.Optional ? '?' : '')).join(', ')}${props.length > 6 ? ', …' : ''}}`
    : p.getName();
  return name + (optional ? '?' : '');
}

const renderSig = (name, sig) => `${name}(${sig.getParameters().map(renderParam).join(', ')})`;

// Types reached from a namespace (Query, Presence, …), rendered once each below it.
const subTypes = new Map();
function addSubType(label, type) {
  if (subTypes.has(label)) return;
  subTypes.set(label, null);
  subTypes.set(label, renderMembers(type, label));
}

function renderMembers(type, owner) {
  return members(type).map(({ name, sig, type: t }) => {
    if (!sig) {
      if (!hasMethods(t)) return null;
      const label = name[0].toUpperCase() + name.slice(1);
      addSubType(label, t);
      return `${name} → ${label}`;
    }
    if (sig.getReturnType().getSymbol()?.getName() === 'AsyncGenerator') return `${renderSig(name, sig)} → async iterable (for await)`;
    const ret = unwrap(sig.getReturnType());
    const retName = ret.getSymbol()?.getName();
    if (retName && retName !== owner && retName !== '__type' && hasMethods(ret)) {
      addSubType(retName, ret);
      return `${renderSig(name, sig)} → ${retName}`;
    }
    return renderSig(name, sig);
  }).filter(Boolean).join(' · ');
}

const sourceFile = program.getSourceFile(join(sdkSrc, 'core', 'shareout.ts'));
const shareOutSym = checker.getSymbolAtLocation(
  sourceFile.statements.find((s) => ts.isClassDeclaration(s) && s.name?.text === 'ShareOut').name,
);
const instanceType = checker.getDeclaredTypeOfSymbol(shareOutSym);
const staticType = checker.getTypeOfSymbolAtLocation(shareOutSym, shareOutSym.valueDeclaration);

const surface = {};
const top = new Map();
for (const m of members(instanceType)) {
  const t = m.sig ? unwrap(m.sig.getReturnType()) : m.type;
  surface[m.name] = members(t).map((x) => x.name).sort();
  top.set(m.name, m);
}
surface.ShareOut = checker.getPropertiesOfType(staticType).map((p) => p.getName()).filter((n) => n !== 'prototype').sort();

for (const name of PROMPT_MEMBERS) if (!top.has(name)) throw new Error(`gen-sdk-reference: sdk.${name} is not in the SDK`);
for (const name of STATICS) if (!surface.ShareOut.includes(name)) throw new Error(`gen-sdk-reference: ShareOut.${name} is not in the SDK`);

const lines = [];
for (const name of PROMPT_MEMBERS) {
  const m = top.get(name);
  const head = m.sig ? `sdk.${renderSig(name, m.sig)}` : `sdk.${name}`;
  const t = m.sig ? unwrap(m.sig.getReturnType()) : m.type;
  lines.push(hasMethods(t) ? `${head}: ${renderMembers(t, t.getSymbol()?.getName())}` : head);
}
for (const [label, body] of subTypes) if (body) lines.push(`  ${label}: ${body}`);

const reference = `# ShareOut SDK Reference
Generated from the SDK's types: these are the only methods that exist — never call anything else. \`?\` = optional, \`→ X\` = returns an X listed below.
\`const sdk = await ShareOut.create()\` (statics: ${STATICS.map((s) => `ShareOut.${s}()`).join(', ')}). Also on sdk: ${Object.keys(surface).filter((k) => k !== 'ShareOut' && !PROMPT_MEMBERS.includes(k)).join(', ')} — use only when the request needs them.
${lines.join('\n')}
`;

const body = `// GENERATED by scripts/gen-sdk-reference.mjs from sdk/src — do not edit by hand.
// Regenerate: npm run build:sdk-reference (check:bundles fails when stale).

export const SDK_SURFACE: Record<string, readonly string[]> = ${JSON.stringify(surface, null, 2)};

export const SDK_REFERENCE = \`${reference.replace(/[\\`$]/g, (c) => '\\' + c)}\`;
`;

writeFileSync(outFile, body);
console.log(`Wrote ${outFile.slice(appRoot.length + 1)} (${reference.length} chars in prompt)`);
