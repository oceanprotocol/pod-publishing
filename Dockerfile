FROM node:10

COPY package*.json ./
RUN npm install

COPY . .

ENTRYPOINT node src/index.js \
  --workflow "$WORKFLOW" \
  --credentials "$CREDENTIALS" \
  --password "$PASSWORD" \
  --inputs "$INPUTS" \
  --transformations "$TRANSFORMATIONS" \
  --verbose
