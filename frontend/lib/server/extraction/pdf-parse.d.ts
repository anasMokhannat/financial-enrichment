/**
 * Type declaration for the deep import of pdf-parse.
 *
 * The package's published types only cover `import pdfParse from
 * "pdf-parse"`, but the package root has a debug-mode side effect that
 * crashes Next.js builds (it tries to read a test PDF at module-load
 * time). We import the lib file directly to skip the debug block and
 * declare its types here.
 */
declare module "pdf-parse/lib/pdf-parse.js" {
  import pdfParse from "pdf-parse";
  export default pdfParse;
}
