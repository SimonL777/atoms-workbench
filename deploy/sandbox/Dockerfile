ARG NODE_IMAGE=node:24-alpine
FROM ${NODE_IMAGE}
WORKDIR /template
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm cache clean --force
COPY tsconfig.json vite.config.js ./
USER node
ENTRYPOINT ["sh","-c","cp /template/package.json /template/tsconfig.json /template/vite.config.js /work/ && ln -s /template/node_modules /work/node_modules && cp -R /input/src /work/src && cd /work && npm run build"]
