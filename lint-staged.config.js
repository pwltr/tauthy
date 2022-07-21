module.exports = {
  'src/**/*.{ts,tsx}': ['yarn format', 'yarn lint:check'],
  '{.{eslintrc.js,prettierrc}}': ['prettier --parser json --write'],
  '*.{yml,md}': ['prettier --single-quote --write'],
}
