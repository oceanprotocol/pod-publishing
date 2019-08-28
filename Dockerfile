FROM node:10

COPY package*.json ./
RUN npm install

COPY . .

ENTRYPOINT node src/index.js \
  --workflow "$WORKFLOW" \
  --node "$NODE" \
  --credentials "$CREDENTIALS" \
  --password "$PASSWORD" \
  --path "$VOLUME" \
  --aquarius-url "$AQUARIUS_URL" \
  --brizo-url "$BRIZO_URL" \
  --secret-store-url "$SECRET_STORE_URL" \
  --verbose \
  # > "$VOLUME/pod-configuration-logs.txt" | tee file
