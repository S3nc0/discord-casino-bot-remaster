// SQL files are imported as strings (tsup `loader: { '.sql': 'text' }`, a Vite plugin in tests).
declare module '*.sql' {
  const sql: string;
  export default sql;
}
