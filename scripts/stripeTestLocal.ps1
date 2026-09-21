param(
  [Parameter(Mandatory=$true)][ValidateSet('emulator','listen','server','catalog')][string]$Mode,
  [string]$SecretDirectory,
  [string]$CatalogSnapshot
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if ($env:VERCEL -or $env:VERCEL_ENV) { throw 'Local execution only' }
if ($Mode -eq 'emulator') {
  npx --yes firebase-tools@15.30.2 emulators:start --only firestore --project demo-verdanza-stripe --config firebase.stripe-test.json
  exit $LASTEXITCODE
}
if (-not $SecretDirectory) { throw 'A private directory containing stripe-test.key is required' }
$stripePrivateDir = (Resolve-Path -LiteralPath $SecretDirectory).Path
$stripeSecret = [IO.File]::ReadAllText((Join-Path $stripePrivateDir 'stripe-test.key')).Trim()
if ($stripeSecret -notmatch '^sk_test_[A-Za-z0-9]+$') { throw 'Only a Stripe TEST key is accepted' }
if ($Mode -eq 'listen') {
  $env:STRIPE_API_KEY = $stripeSecret
  $ErrorActionPreference = 'Continue' # Stripe CLI writes normal status lines to stderr.
  # Filter the CLI stream BEFORE it reaches any console/log.
  npx --yes @stripe/cli@1.51.0 listen --events checkout.session.completed,checkout.session.expired,payment_intent.payment_failed --forward-to http://127.0.0.1:5195/api/stripe-test/webhook 2>&1 | ForEach-Object {
    $stripeLine = $_.ToString()
    if ($stripeLine -match 'whsec_[A-Za-z0-9]+') { [IO.File]::WriteAllText((Join-Path $stripePrivateDir 'webhook-test.key'), $Matches[0]) }
    Write-Output ($stripeLine -replace 'whsec_[A-Za-z0-9]+','[WEBHOOK_SECRET_REDACTED]' -replace '(sk|rk|pk)_(test|live)_[A-Za-z0-9]+','[KEY_REDACTED]')
  }
  exit $LASTEXITCODE
}
$env:STRIPE_TEST_ENABLED = 'true'
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
$env:STRIPE_TEST_SECRET_KEY = $stripeSecret
if ($Mode -eq 'catalog') {
  if (-not $CatalogSnapshot) { throw 'A catalog snapshot is required' }
  node --import tsx scripts/stripeTestCatalog.ts load-emulator $CatalogSnapshot
} else {
  $env:STRIPE_TEST_WEBHOOK_SECRET = [IO.File]::ReadAllText((Join-Path $stripePrivateDir 'webhook-test.key')).Trim()
  npm run dev:stripe-test
}
exit $LASTEXITCODE
