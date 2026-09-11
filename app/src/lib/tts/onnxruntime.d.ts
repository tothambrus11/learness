/** The ONNX Runtime's own declarations, pointed at by hand. */

/* onnxruntime-web's package.json `exports` map names no "types" condition, so
   `onnxruntime-web/webgpu` resolves to JavaScript with no types at all and a
   `types=` reference to the package is refused. Naming the file is what is left. */
/* oxlint-disable-next-line typescript/triple-slash-reference -- the package
   offers its types no other way; see above. */
/// <reference path="../../../node_modules/onnxruntime-web/types.d.ts" />
