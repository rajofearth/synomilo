@echo off
cd /d "P:\Projects\cometchat-sample-app"
call npx react-native start --port 8081 > "%~dp0metro.log" 2>&1
