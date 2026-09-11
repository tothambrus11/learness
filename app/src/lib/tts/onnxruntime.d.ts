/** The ONNX Runtime's own declarations, pointed at by hand. */

/* onnxruntime-web ships a `types.d.ts` that declares itself and each of its four
   entry points, but its package.json `exports` map names no "types" condition —
   so resolving `onnxruntime-web/webgpu` the way a bundler does finds the built
   JavaScript and no types at all, and a `types=` reference to the package is
   refused for the same reason. Naming the file is what is left, and it pulls
   those declarations into the program once, for the worker and for the pipeline
   beside it. */
/* oxlint-disable-next-line typescript/triple-slash-reference -- the package
   offers its types no other way; see above. */
/// <reference path="../../../node_modules/onnxruntime-web/types.d.ts" />
