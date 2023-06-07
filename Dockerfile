FROM python:3.8.5

RUN groupadd -r keeper && useradd --no-log-init -r -g keeper keeper

COPY bin /opt/keeper/auction-keeper/bin
COPY auction_keeper /opt/keeper/auction-keeper/auction_keeper
COPY lib /opt/keeper/auction-keeper/lib
COPY models /opt/keeper/auction-keeper/models
COPY install.sh /opt/keeper/auction-keeper/install.sh
COPY requirements.txt /opt/keeper/auction-keeper/requirements.txt

WORKDIR /opt/keeper/auction-keeper
RUN pip3 install virtualenv
RUN ./install.sh
WORKDIR /opt/keeper/auction-keeper/bin

USER keeper
ENTRYPOINT ["./auction-keeper"]
