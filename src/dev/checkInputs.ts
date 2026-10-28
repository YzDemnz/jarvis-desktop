/** Recognized public files that define project checks. A bounded heuristic, not a sandbox. */
export const checkInput = (p: string) => /(^|\/)(tests?|specs?|__tests__|fixtures?)(\/|\.)|(?:^|\/)[^/]*[.-](test|spec)\.|(^|\/)(package(?:-lock)?\.json|npm-shrinkwrap\.json|.*lock.*|tsconfig[^/]*\.json|.*(?:jest|vitest|eslint|pytest|babel).*|Cargo\.toml|pyproject\.toml|\.gitignore)$/i.test(p);
