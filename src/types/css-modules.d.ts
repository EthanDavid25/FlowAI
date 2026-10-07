/**
 * CSS Module type declarations.
 * TypeScript does not understand CSS module imports out-of-the-box.
 * This tells the compiler that any *.module.css import is a valid module
 * whose exports are a record of class name strings.
 */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.module.scss' {
  const classes: Record<string, string>
  export default classes
}
