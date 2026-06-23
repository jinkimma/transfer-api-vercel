# Merge AI - 多模型协作调用脚本 (PowerShell)
# 用法: .\merge.ps1 "model1,model2" "你的问题"
# 示例: .\merge.ps1 "gateway-gpt-5-5,gateway-gpt-4o" "解释量子计算"

param(
    [Parameter(Mandatory=$true)]
    [string]$Models,

    [Parameter(Mandatory=$true)]
    [string]$Prompt
)

$API_URL = "https://unlimited-transfer-api.jinkimma-copilot-opus47.workers.dev/v1/merge"
$API_KEY = "ua_c1tpKRkd4A-fB-f0Dr-lj8Wa-arSKQID"

Write-Host "🤖 调用 Merge AI (多模型协作)..." -ForegroundColor Cyan
Write-Host "📋 模型: $Models" -ForegroundColor Yellow
Write-Host "❓ 问题: $Prompt" -ForegroundColor Yellow
Write-Host ""
Write-Host "⏳ 等待响应..." -ForegroundColor DarkGray

# 转换为 JSON 数组
$modelsArray = $Models -split ',' | ForEach-Object { $_.Trim() }
$body = @{
    models = $modelsArray
    prompt = $Prompt
    stream = $false
} | ConvertTo-Json -Compress

try {
    $response = Invoke-RestMethod -Uri $API_URL `
        -Method Post `
        -Headers @{
            "Authorization" = "Bearer $API_KEY"
            "Content-Type" = "application/json"
        } `
        -Body $body

    if ($response.error) {
        Write-Host "❌ 错误: $($response.error.message)" -ForegroundColor Red
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
    Write-Host "❌ 请求失败: $_" -ForegroundColor Red
    exit 1
}
