/** ONNX Runtime publishes one set of types for every build, declared as
 *  ambient modules in its own types.d.ts — which TypeScript only loads when
 *  the bare package name is imported, and this app imports the WebGPU entry
 *  point directly. The API is the common one whichever backend is compiled
 *  in, so that is what the subpath is declared to export. */
declare module 'onnxruntime-web/webgpu' {
  export * from 'onnxruntime-common';
}
