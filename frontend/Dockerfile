FROM node:22-alpine

WORKDIR /app

# Add package manifests and application source as the frontend is implemented.
COPY package*.json ./
RUN npm ci
COPY . .

EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
