#!/bin/bash

echo "🔵 Killing old processes…"
killall -9 node 2>/dev/null
killall -9 metro 2>/dev/null
killall -9 ruby 2>/dev/null
killall -9 watchman 2>/dev/null

echo "🚀 Starting Metro..."
npx expo start --clear &
sleep 3

echo "📱 Launching iOS simulator..."
npx expo run:ios --no-bundler &
sleep 3

echo "🤖 Launching Android emulator..."
npx expo run:android --no-bundler &
