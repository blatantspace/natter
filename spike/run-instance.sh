#!/bin/zsh
# usage: spike/run-instance.sh <profile> <cdp-port>
export PATH="$HOME/.nvm/versions/node/v22.22.1/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export QUEUEUE_PROFILE="$1"
export QUEUEUE_DEBUG=1
cd $HOME/queueue
exec ./node_modules/.bin/electron . --remote-debugging-port="$2" > "/tmp/queueue-$1.log" 2>&1
