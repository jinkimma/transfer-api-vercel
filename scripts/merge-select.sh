#!/bin/bash
# Merge AI - 交互式模型组合选择脚本
# 用法: ./merge-select.sh "你的问题"
# 示例: ./merge-select.sh "解释量子计算"

API_URL="https://unlimited-transfer-api.jinkimma-copilot-opus47.workers.dev/v1/merge"
API_KEY="ua_c1tpKRkd4A-fB-f0Dr-lj8Wa-arSKQID"

PROMPT="$1"

if [ -z "$PROMPT" ]; then
    echo "用法: merge-select.sh \"你的问题\""
    exit 1
fi

# 预设组合
declare -A PRESETS
PRESETS["1"]="gateway-gpt-5-5,gateway-gpt-4o"
PRESETS["2"]="gateway-gpt-5-5,gateway-gpt-5"
PRESETS["3"]="gateway-gpt-5-5,gateway-gpt-4o,gateway-gpt-5"
PRESETS["4"]="gateway-gpt-5,gateway-gpt-4o"
PRESETS["5"]="gateway-gpt-5-5,gateway-gpt-o3"
PRESETS["6"]="gateway-gpt-5-5,gateway-gpt-5-mini,gateway-gpt-4o"

declare -A PRESET_NAMES
PRESET_NAMES["1"]="GPT-5.5 + GPT-4o"
PRESET_NAMES["2"]="GPT-5.5 + GPT-5"
PRESET_NAMES["3"]="GPT-5.5 + GPT-4o + GPT-5"
PRESET_NAMES["4"]="GPT-5 + GPT-4o"
PRESET_NAMES["5"]="GPT-5.5 + GPT-o3"
PRESET_NAMES["6"]="GPT-5.5 + GPT-5-mini + GPT-4o"

echo ""
echo -e "\033[36m🤖 Merge AI - 多模型协作\033[0m"
echo -e "\033[36m=========================\033[0m"
echo ""
echo -e "\033[33m请选择模型组合:\033[0m"
echo ""

for key in 1 2 3 4 5 6; do
    models="${PRESETS[$key]}"
    name="${PRESET_NAMES[$key]}"
    echo -e "  \033[32m[$key]\033[0m $name"
    echo -e "      模型: ${models//,/ + }"
    echo ""
done

echo -e "\033[33m请输入编号 (1-6): \033[0m" | tr -d '\n'
read choice

if [ -z "${PRESETS[$choice]}" ]; then
    echo -e "\033[31m❌ 无效的选择\033[0m"
    exit 1
fi

models="${PRESETS[$choice]}"
name="${PRESET_NAMES[$choice]}"

echo ""
echo -e "\033[32m✅ 已选择: $name\033[0m"
echo -e "\033[90m📋 模型: ${models//,/, }\033[0m"
echo ""

# 转换为 JSON 数组
IFS=',' read -ra MODEL_ARRAY <<< "$models"
MODELS_JSON=$(printf '%s\n' "${MODEL_ARRAY[@]}" | jq -R . | jq -s .)

PAYLOAD=$(jq -n \
    --argjson models "$MODELS_JSON" \
    --arg prompt "$PROMPT" \
    '{
        models: $models,
        prompt: $prompt,
        stream: false
    }')

echo -e "\033[90m⏳ 等待响应...\033[0m"
echo ""

response=$(curl -s -X POST "$API_URL" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD")

if echo "$response" | jq -e '.error' > /dev/null 2>&1; then
    echo -e "\033[31m❌ 错误:\033[0m"
    echo "$response" | jq -r '.error.message // .error'
    exit 1
fi

text=$(echo "$response" | jq -r '.choices[0].message.content // .text // . // empty')

if [ -n "$text" ]; then
    echo "$text"
else
    echo "$response" | jq .
fi
