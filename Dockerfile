FROM node:14
WORKDIR /usr/src/app
COPY . .
RUN npm install
EXPOSE 80
CMD [ "node", "current_consumption.js" ]
