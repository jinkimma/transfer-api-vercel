#!/bin/bash
# Merge AI - 多模型协作调用脚本
# 用法: ./merge.sh "model1,model2" "your prompt here"
# 示例: ./merge.sh "gateway-gpt-5-5,gateway-gpt-4o" "解释量子计算"

set -e

API_URL="https://unlimited-transfer-api.jinkimma-copilot-opus47.workers.dev/v1/merge"
API_KEY="ua_c1tpKRkd4A-fB-f0Dr-lj8Wa-arSKQID"

MODELS="$1"
PROMPT="$2"

if [ -z "$MODELS" ] || [ -z "$PROMPT" ]; then
    echo "用法: merge.sh \"model1,model2\" \"你的问题\""
    echo ""
    echo "可用模型:"
    echo "  gateway-gpt-5-5    - GPT-5.5 (推荐)"
    echo "  gateway-gpt-5      - GPT-5"
    echo "  gateway-gpt-4o     - GPT-4o"
    echo "  gateway-gpt-5-mini - GPT-5 mini"
    echo "  gateway-gpt-o3     - GPT-o3"
    echo ""
    echo "示例:"
    echo '  ./merge.sh "gateway-gpt-5-5,gateway-gpt-4o" "解释量子计算"'
    exit 1
fi

# 转换为数组
IFS=',' read -ra MODEL_ARRAY <<< "$MODELS"

# 构建 models JSON 数组
MODELS_JSON=$(printf '%s\n' "${MODEL_ARRAY[@]}" | jq -R . | jq -s .)

# 构建请求
PAYLOAD=$(jq -n \
    --argjson models "$MODELS_JSON" \
    --arg prompt "$PROMPT" \
    '{
        models: $models,
        prompt: $prompt,
        stream: false
    }')

echo "🤖 调用 Merge AI (多模型协作)..."
echo "📋 模型: $MODELS"
echo "❓ 问题: $PROMPT"
echo ""
echo "⏳ 等待响应..."
echo ""

# 发送请求
response=$(curl -s -X POST "$API_URL" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD")

# 解析响应
if echo "$response" | jq -e '.error' > /dev/null 2>&1; then
    echo "❌ 错误:"
    echo "$response" | jq -r '.error.message // .error'
    exit 1
fi

# 提取文本内容
text=$(echo "$response" | jq -r '.choices[0].message.content // .text // . // empty')

if [ -n "$text" ]; then
    echo "$text"
else
    echo "$response" | jq .
fi
