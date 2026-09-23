/* eslint-disable @typescript-eslint/no-explicit-any */
declare module '*.svg' {
  const content: any;
  export const ReactComponent: any;
  export default content;
}

// Stylesheets imported for their side effects (app/global.css). Declared here so
// type checking does not depend on the generated next-env.d.ts.
declare module '*.css';
