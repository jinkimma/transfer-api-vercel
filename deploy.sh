#!/bin/bash
# Deploy script for transfer-api to Vercel
# Run this in the transfer-api directory

echo "Deploying to Vercel..."

# Option 1: With Vercel token from environment
if [ -n "$VERCEL_TOKEN" ]; then
    echo "Using Vercel token from environment..."
    npx vercel --yes --prod --token=$VERCEL_TOKEN
else
    # Option 2: Interactive login
    echo "No token found. Please run one of the following:"
    echo ""
    echo "1. Set VERCEL_TOKEN and deploy:"
    echo "   export VERCEL_TOKEN=your_token_here"
    echo "   npx vercel --yes --prod"
    echo ""
    echo "2. Or login interactively:"
    echo "   npx vercel login"
    echo "   npx vercel --prod"
    echo ""
    echo "To get your token: https://vercel.com/account/tokens"
fi
