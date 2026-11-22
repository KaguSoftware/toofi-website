#!/usr/bin/env bash
# Bundle knock-outs for S2, run in a throwaway worktree (never in the main checkout).
# Each experiment replaces one dependency's import with an empty stand-in, rebuilds through the
# rig and prints the first-render and on-demand JavaScript totals (gzip and brotli) from the
# rig's bundle report. The stand-ins break the feature at run time: they measure what a
# dependency weighs in the build, they are not fixes.
#   scripts/perf/S2/knockout.sh <baseline|theatre|gsap|n8ao|editor|editor+theatre>
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exp="${1:?experiment name}"
git checkout -- components lib app
rm -f components/editable/lazy.tsx components/sawad/experience/theatreStub.ts
nocheck() { sed -i '' '1i\
// @ts-nocheck
' "$1"; }
want() { case "+$exp+" in *"+$1+"*) return 0 ;; *) return 1 ;; esac; }
case "$exp" in baseline|theatre|gsap|n8ao|editor|editor+theatre) ;; *) echo "unknown experiment $exp"; exit 2 ;; esac
if want theatre; then
  nocheck components/sawad/experience/storySheet.ts
  sed -i '' 's#from "@theatre/core"#from "./theatreStub"#' components/sawad/experience/storySheet.ts
  cat > components/sawad/experience/theatreStub.ts <<'STUB'
export const getProject = (): any => ({ sheet: () => ({ object: () => ({}) }), ready: Promise.resolve() });
export const types: any = { number: () => 0, compound: () => ({}) };
STUB
fi
if want gsap; then
  nocheck components/sawad/experience/StoryScroll.tsx
  sed -i '' 's#import gsap from "gsap";#const gsap: any = new Proxy({}, { get: () => () => ({}) });#; s#import { ScrollTrigger } from "gsap/ScrollTrigger";#const ScrollTrigger: any = new Proxy({}, { get: () => () => ({}) });#' components/sawad/experience/StoryScroll.tsx
fi
if want n8ao; then
  nocheck components/sawad/experience/PostFX.tsx
  sed -i '' 's#Bloom, DepthOfField, EffectComposer, N8AO, Noise#Bloom, DepthOfField, EffectComposer, Noise#' components/sawad/experience/PostFX.tsx
  printf 'const N8AO: any = () => null;\n' >> components/sawad/experience/PostFX.tsx
fi
if want editor; then
  cat > components/editable/lazy.tsx <<'LAZY'
"use client";
import dynamic from "next/dynamic";
export const EditableTextClient = dynamic(() => import("./EditableText").then((m) => m.EditableTextClient));
export const EditableRichTextClient = dynamic(() => import("./EditableRichText").then((m) => m.EditableRichTextClient));
export const EditableImageClient = dynamic(() => import("./EditableImage").then((m) => m.EditableImageClient));
export const EditableLinkClient = dynamic(() => import("./EditableLink").then((m) => m.EditableLinkClient));
export const EditableListClient = dynamic(() => import("./EditableList").then((m) => m.EditableListClient));
export const EditorRoot = dynamic(() => import("./EditorRoot").then((m) => m.EditorRoot));
LAZY
  printf 'export { EditableTextClient, EditableRichTextClient, EditableImageClient, EditableLinkClient, EditableListClient, EditorRoot } from "./lazy";\n' > components/editable/client.ts
fi
node scripts/perf/bundles.mjs --no-analyze > "/tmp/s2-ko-$exp.log" 2>&1 || { tail -20 "/tmp/s2-ko-$exp.log"; exit 1; }
dir=$(ls -d scripts/perf/results/*-bundles | sort | tail -1)
node -e "
const r=require('./$dir/bundles.json');const k=(b)=>(b/1024).toFixed(1);
const pub=r.routes.find(x=>x.route.includes('slug'));
const lz=r.lazy.reduce((a,c)=>({g:a.g+c.gzip,b:a.b+c.brotli}),{g:0,b:0});
console.log('$exp'.padEnd(16),'public first render gzip',k(pub.js.gzip),'brotli',k(pub.js.brotli),'| on demand gzip',k(lz.g),'brotli',k(lz.b),'| total gzip',k(pub.js.gzip+lz.g));"
