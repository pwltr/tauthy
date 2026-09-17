module.exports = {
  'src/**/*.{ts,tsx}': ['prettier --write', 'eslint --ext .ts,.tsx'],
  '{.{eslintrc.js,prettierrc}}': ['prettier --parser json --write'],
  '*.{yml,md}': ['prettier --write'],
}
