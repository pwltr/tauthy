import Typography from '@mui/material/Typography'

const RecoveryCodeDisplay = ({ code }: { code: string }) => (
  <Typography
    component="code"
    variant="body2"
    sx={{
      display: 'block',
      mt: 2,
      fontFamily: 'monospace',
      overflowWrap: 'anywhere',
      userSelect: 'text',
    }}
  >
    {code}
  </Typography>
)

export default RecoveryCodeDisplay
