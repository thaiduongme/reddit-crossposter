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
RUN apt-get install -y libnss3 libgtk-3-0 libgbm-dev libasound2

# To kill process on port library (cross-port-killer)
RUN apt-get install lsof

WORKDIR /reddit-crossposter
COPY package.json .
COPY yarn.lock .
RUN yarn install
RUN npm install -g pm2
RUN pm2 install pm2-logrotate

COPY . .

CMD ["pm2-runtime", "start", "ecosystem.config.js"]