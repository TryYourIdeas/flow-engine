
DOMAIN=$(jq -r '.domain' ./project-config.json)
SERVER=$(jq -r '.server' ./project-config.json)

if [ -n "$DOMAIN" ]; then
    echo "Getting logs for $DOMAIN."
    scp aws-$SERVER:/home/ubuntu/.pm2/logs/$DOMAIN-out.log .logs
    scp aws-$SERVER:/home/ubuntu/.pm2/logs/$DOMAIN-error.log .logs
else
        echo "USAGE: get-logs.sh <project>"
fi