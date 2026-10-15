FROM alpine:3.21
RUN apk add --no-cache openssh openssh-sftp-server bash && adduser -D -s /bin/bash tester && echo 'tester:fixture-password' | chpasswd && ssh-keygen -A
RUN printf 'PasswordAuthentication yes\nPermitRootLogin no\nUsePAM no\nPerSourcePenalties no\nSubsystem sftp internal-sftp\n' > /etc/ssh/sshd_config
EXPOSE 22
CMD ["/usr/sbin/sshd","-D","-e"]
