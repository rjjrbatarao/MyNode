#!/bin/bash
cd /var/www/mynode/
PATH="$HOME/.nvm/versions/node/v14.16.1/bin:$PATH"
nodemon index.js
