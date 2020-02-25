FROM node:10
WORKDIR /usr/src/app
COPY . .
RUN npm install
EXPOSE 7667
CMD [ "node", "current_consumption.js" ]
