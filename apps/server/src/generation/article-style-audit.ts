// This module was split into ./style-audit/* (one file per detector family) for
// maintainability. It is preserved as a thin re-export shim so existing importers
// (step-runner, tests) keep the same import path and public API.
export * from "./style-audit";
