#!/data/data/com.termux/files/usr/bin/sh
cd ~/zee-app
# kill any existing app session
tmux kill-session -t zee-app 2>/dev/null
tmux new -d -s zee-app "node server.js 2>&1 | tee -a ~/zee-app.log"
echo "Zee app started. Attach with: tmux attach -t zee-app"
