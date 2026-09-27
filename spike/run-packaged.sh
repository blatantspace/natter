#!/bin/zsh
# usage: spike/run-packaged.sh <profile> <cdp-port>
export QUEUEUE_PROFILE="$1"
export QUEUEUE_DEBUG=1
exec $HOME/queueue/dist/mac-arm64/queueue.app/Contents/MacOS/queueue --remote-debugging-port="$2" > "/tmp/queueue-$1.log" 2>&1
