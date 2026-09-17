module.exports = {
  'src/**/*.{ts,tsx}': ['prettier --write', 'eslint --ext .ts,.tsx'],
  '{.{prettierrc},eslint.config.js}': ['prettier --write'],
  '*.{yml,md}': ['prettier --write'],
}
