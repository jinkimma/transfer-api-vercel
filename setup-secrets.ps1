# GitHub Secrets 配置脚本
# 需要 GitHub Personal Access Token

param(
    [Parameter(Mandatory=$true)]
    [string]$GithubToken,

    [Parameter(Mandatory=$true)]
    [string]$VercelToken,

    [string]$VercelOrgId = "team_9eZ2FxEPC8LoDLWryW4g047Y",
    [string]$VercelProjectId = "prj_TUvTsgfglci5VtnREvMMDTyE0x2Z",
    [string]$Repo = "jinkimma/transfer-api-vercel"
)

$headers = @{
    "Authorization" = "Bearer $GithubToken"
    "Accept" = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

function Set-GithubSecret {
    param($name, $value)

    Write-Host "Setting $name..."

    # Generate a random secret name suffix
    $keyId = [guid]::NewGuid().ToString("N")

    # Get public key for repo
    $pubKeyUrl = "https://api.github.com/repos/$Repo/actions/secrets/public-key"
    $pubKey = Invoke-RestMethod -Uri $pubKeyUrl -Headers $headers
    Write-Host "  Got public key ID: $($pubKey.key_id)"

    # Encrypt secret using RSA-OAEP
    $pubKeyPem = "-----BEGIN PUBLIC KEY-----
$($pubKey.key)
-----END PUBLIC KEY-----"

    $tempPubKeyFile = "$env:TEMP\pubkey_$keyId.pem"
    $tempValueFile = "$env:TEMP\value_$keyId.bin"
    $tempEncryptedFile = "$env:TEMP\encrypted_$keyId.bin"

    # Save PEM to file
    $pubKeyPem | Out-File -FilePath $tempPubKeyFile -Encoding ASCII

    # Convert value to bytes and save
    $valueBytes = [System.Text.Encoding]::UTF8.GetBytes($value)
    [System.IO.File]::WriteAllBytes($tempValueFile, $valueBytes)

    # Encrypt using OpenSSL
    $opensslCmd = "openssl rsautl -encrypt -pubin -inkey `"$tempPubKeyFile`" -in `"$tempValueFile`" -out `"$tempEncryptedFile`""
    Invoke-Expression $opensslCmd 2>&1 | Out-Null

    $encryptedValue = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($tempEncryptedFile))

    # Set secret
    $body = @{
        "encrypted_value" = $encryptedValue
        "key_id" = $pubKey.key_id
    } | ConvertTo-Json

    $secretUrl = "https://api.github.com/repos/$Repo/actions/secrets/$name"
    Invoke-RestMethod -Uri $secretUrl -Headers $headers -Method PUT -Body $body -ContentType "application/json"

    # Cleanup
    Remove-Item $tempPubKeyFile -ErrorAction SilentlyContinue
    Remove-Item $tempValueFile -ErrorAction SilentlyContinue
    Remove-Item $tempEncryptedFile -ErrorAction SilentlyContinue

    Write-Host "  ✓ $name set successfully"
}

Write-Host "Configuring GitHub Secrets for $Repo`n"

# Set secrets
Set-GithubSecret -name "VERCEL_TOKEN" -value $VercelToken
Set-GithubSecret -name "VERCEL_ORG_ID" -value $VercelOrgId
Set-GithubSecret -name "VERCEL_PROJECT_ID" -value $VercelProjectId

Write-Host "`n✅ All secrets configured!`n"
Write-Host "Triggering workflow..."
Start-Process "https://github.com/jinkimma/transfer-api-vercel/actions"
