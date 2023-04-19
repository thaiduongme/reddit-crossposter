FROM phusion/baseimage:master as init
FROM node:slim

# Setup
ARG APT_FLAGS="-q -y --no-install-recommends"
ENV DEBIAN_FRONTEND noninteractive
RUN apt-get update -q

# System deps
RUN apt-get install -q -y python3-minimal

# Init
COPY --from=init /sbin/my_init /sbin/my_init
RUN apt-get install $APT_FLAGS runit
RUN \
    chmod +x /sbin/my_init && \
    mkdir -p /etc/my_init.d && \
    mkdir -p /etc/my_init.pre_shutdown.d && \
    mkdir -p /etc/my_init.post_shutdown.d

# Xvfb
ENV DISPLAY=:99
COPY services/xvfb.init /etc/service/xvfb/run
RUN \
    apt-get install $APT_FLAGS xvfb && \
    chmod +x /etc/service/xvfb/run
RUN apt-get update && apt-get install -yq gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils wget x11vnc x11-xkb-utils xfonts-100dpi xfonts-75dpi xfonts-scalable xfonts-cyrillic x11-apps libcurl3-gnutls

# To kill process on port library (cross-port-killer)
RUN apt-get install lsof

WORKDIR /reddit-crossposter
COPY package.json .
COPY yarn.lock .
RUN yarn install
RUN npm install -g pm2

COPY . .

CMD ["pm2-runtime", "start", "ecosystem.config.js"]