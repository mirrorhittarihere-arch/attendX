$ErrorActionPreference = 'Stop'

$defaultRoute = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' |
  Sort-Object RouteMetric |
  Select-Object -First 1
$wifiAddress = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $defaultRoute.InterfaceIndex |
  Where-Object { $_.AddressState -eq 'Preferred' -and $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  Select-Object -First 1 -ExpandProperty IPAddress

if (-not $wifiAddress) {
  throw 'Could not find the computer IPv4 address. Connect to Wi-Fi and try again.'
}

$certificateDirectory = Join-Path $env:LOCALAPPDATA 'AttendX\dev-certs'
$rootCertificatePath = Join-Path $certificateDirectory 'attendx-dev-root.cer'
$serverCertificatePath = Join-Path $certificateDirectory 'attendx-dev-server.pfx'
$passphrasePath = Join-Path $certificateDirectory 'attendx-dev-server-passphrase.txt'
$addressPath = Join-Path $certificateDirectory 'attendx-dev-server-address.txt'
New-Item -ItemType Directory -Path $certificateDirectory -Force | Out-Null

$savedAddress = if (Test-Path $addressPath) { Get-Content $addressPath -Raw } else { '' }
if ($savedAddress.Trim() -ne $wifiAddress -or
    -not (Test-Path $rootCertificatePath) -or
    -not (Test-Path $serverCertificatePath) -or
    -not (Test-Path $passphrasePath)) {

  Get-ChildItem 'Cert:\CurrentUser\My' |
    Where-Object { $_.Subject -eq 'CN=AttendX Local Development CA' -or $_.Subject -eq 'CN=AttendX Local Development Server' } |
    Remove-Item
  Get-ChildItem 'Cert:\CurrentUser\Root' |
    Where-Object { $_.Subject -eq 'CN=AttendX Local Development CA' } |
    Remove-Item

  $rootCertificate = New-SelfSignedCertificate `
    -Subject 'CN=AttendX Local Development CA' `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -KeyExportPolicy Exportable `
    -KeyUsage CertSign, CRLSign, DigitalSignature `
    -TextExtension @('2.5.29.19={critical}{text}ca=1')

  $serverCertificate = New-SelfSignedCertificate `
    -Subject 'CN=AttendX Local Development Server' `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -Signer $rootCertificate `
    -KeyExportPolicy Exportable `
    -KeyUsage DigitalSignature, KeyEncipherment `
    -TextExtension @("2.5.29.17={text}IPAddress=$wifiAddress&DNS=localhost")

  Export-Certificate -Cert $rootCertificate -FilePath $rootCertificatePath -Type CERT | Out-Null
  $passphrase = [Guid]::NewGuid().ToString('N')
  $securePassphrase = ConvertTo-SecureString -String $passphrase -AsPlainText -Force
  Export-PfxCertificate -Cert $serverCertificate -FilePath $serverCertificatePath -Password $securePassphrase | Out-Null
  ConvertFrom-SecureString $securePassphrase | Set-Content -Path $passphrasePath
  Set-Content -Path $addressPath -Value $wifiAddress -NoNewline
}

$rootThumbprint = ([System.Security.Cryptography.X509Certificates.X509Certificate2]::new($rootCertificatePath)).Thumbprint
$trustedRoot = Get-ChildItem 'Cert:\CurrentUser\Root' | Where-Object { $_.Thumbprint -eq $rootThumbprint }
if (-not $trustedRoot) {
  & certutil.exe -user -addstore Root $rootCertificatePath
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not trust the local HTTPS certificate on Windows. Run PowerShell as your user and retry.'
  }
}

$securePassphrase = Get-Content $passphrasePath | ConvertTo-SecureString
$passphrasePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassphrase)
try {
  $env:HOST = '0.0.0.0'
  $env:PORT = if ($env:PORT) { $env:PORT } else { '8003' }
  $env:HTTPS_PORT = if ($env:HTTPS_PORT) { $env:HTTPS_PORT } else { '8443' }
  $env:HTTPS_PFX = $serverCertificatePath
  $env:HTTPS_PFX_PASSPHRASE = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passphrasePointer)
  $env:HTTPS_ROOT_CERT = $rootCertificatePath

  Write-Host "Phone HTTP address:  http://${wifiAddress}:$env:PORT/"
  Write-Host "Phone HTTPS address: https://${wifiAddress}:$env:HTTPS_PORT/"
  Write-Host "Install certificate: http://${wifiAddress}:$env:PORT/attendx-dev-root.cer"
  Write-Host 'The development CA is trusted for this Windows user; install it separately on the phone.'
  Write-Host 'Keep this window open while testing. Press Ctrl+C to stop the server.'
  node (Join-Path $PSScriptRoot 'dev-server.js')
}
finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passphrasePointer)
  Remove-Item Env:\HTTPS_PFX_PASSPHRASE -ErrorAction SilentlyContinue
}
