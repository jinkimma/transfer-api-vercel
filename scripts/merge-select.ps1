# Merge AI - Interactive Model Selection Script
# Usage: .\merge-select.ps1 "Your question"
# Example: .\merge-select.ps1 "Explain quantum computing"

param(
    [Parameter(Mandatory=$true)]
    [string]$Prompt
)

# Presets
$presets = @{
    "1" = @{ name = "GPT-5.5 + GPT-4o"; models = @("gateway-gpt-5-5", "gateway-gpt-4o") }
    "2" = @{ name = "GPT-5.5 + GPT-5"; models = @("gateway-gpt-5-5", "gateway-gpt-5") }
    "3" = @{ name = "GPT-5.5 + GPT-4o + GPT-5"; models = @("gateway-gpt-5-5", "gateway-gpt-4o", "gateway-gpt-5") }
    "4" = @{ name = "GPT-5 + GPT-4o"; models = @("gateway-gpt-5", "gateway-gpt-4o") }
    "5" = @{ name = "GPT-5.5 + GPT-o3"; models = @("gateway-gpt-5-5", "gateway-gpt-o3") }
    "6" = @{ name = "GPT-5.5 + GPT-5-mini + GPT-4o"; models = @("gateway-gpt-5-5", "gateway-gpt-5-mini", "gateway-gpt-4o") }
}

$API_URL = "https://unlimited-transfer-api.jinkimma-copilot-opus47.workers.dev/v1/merge"
$API_KEY = "ua_c1tpKRkd4A-fB-f0Dr-lj8Wa-arSKQID"

Write-Host ""
Write-Host "=== Merge AI - Multi-Model Collaboration ===" -ForegroundColor Cyan
Write-Host ""

# Display menu
foreach ($key in ($presets.Keys | Sort-Object)) {
    $preset = $presets[$key]
    $modelsStr = $preset.models -join " + "
    Write-Host "[$key] $($preset.name)" -ForegroundColor Green
    Write-Host "    Models: $modelsStr" -ForegroundColor Gray
    Write-Host ""
}

# Read user choice
Write-Host "Enter number (1-6): " -NoNewline -ForegroundColor Yellow
$choice = Read-Host

# Validate
if (-not $presets.ContainsKey($choice)) {
    Write-Host "Invalid choice!" -ForegroundColor Red
    exit 1
}

$selected = $presets[$choice]
Write-Host ""
Write-Host "Selected: $($selected.name)" -ForegroundColor Green
Write-Host "Models: $($selected.models -join ', ')" -ForegroundColor Gray
Write-Host ""

# Build request
$body = @{
    models = $selected.models
    prompt = $Prompt
    stream = $false
} | ConvertTo-Json -Compress

Write-Host "Waiting for response..." -ForegroundColor DarkGray
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri $API_URL `
        -Method Post `
        -Headers @{
            "Authorization" = "Bearer $API_KEY"
            "Content-Type" = "application/json"
        } `
        -Body $body

    if ($response.error) {
        Write-Host "Error: $($response.error.message)" -ForegroundColor Red
        exit 1
    }

    $text = $response.choices[0].message.content
    if (-not $text) {
        $text = $response.text
    }
    if (-not $text) {
        $text = $response | ConvertTo-Json -Depth 10
    }

    Write-Host ""
    Write-Host $text
}
catch {
    Write-Host "Request failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
