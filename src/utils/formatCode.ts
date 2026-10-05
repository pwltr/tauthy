export const formatCode = (code: string, groupByTwos = false): string =>
  code.match(groupByTwos ? /.{1,2}/g : /.{1,3}/g)?.join(' ') ?? ''
