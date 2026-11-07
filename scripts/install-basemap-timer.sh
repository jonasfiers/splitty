#!/bin/bash
# Install the monthly vector map update on pve. Runs ON PVE, as root, from a
# folder holding this script and update-basemap.sh:
#
#   bash install-basemap-timer.sh
#
# Installs /root/update-basemap.sh and three systemd units:
#   update-basemap.timer          first Sunday of each month, 03:00 (a missed
#                                 run, pve being off, happens at the next boot)
#   update-basemap.service        runs the script (a second run cannot start
#                                 while one is going)
#   update-basemap-failed.service mails root (Jonas) the end of the log when
#                                 an update fails; the current map stays as is
# Safe to run again: it only rewrites the same files.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
install -m 755 "$HERE/update-basemap.sh" /root/update-basemap.sh

cat > /etc/systemd/system/update-basemap.service <<'EOF'
[Unit]
Description=Update the Splitty vector map (Protomaps planet)
Wants=network-online.target
After=network-online.target
OnFailure=update-basemap-failed.service

[Service]
Type=oneshot
ExecStart=/bin/bash /root/update-basemap.sh
Nice=10
IOSchedulingClass=idle
TimeoutStartSec=24h
EOF

cat > /etc/systemd/system/update-basemap.timer <<'EOF'
[Unit]
Description=Monthly Splitty vector map update

[Timer]
OnCalendar=Sun *-*-01..07 03:00
Persistent=true
RandomizedDelaySec=30min

[Install]
WantedBy=timers.target
EOF

cat > /etc/systemd/system/update-basemap-failed.service <<'EOF'
[Unit]
Description=Mail root that the vector map update failed

[Service]
Type=oneshot
ExecStart=/bin/bash -c '{ printf "Subject: Splitty map update failed on pve\n\nThe monthly vector map update failed; the map in use is unchanged.\nLast log lines (journalctl -u update-basemap):\n\n"; journalctl -u update-basemap -n 30 --no-pager -o short-iso; } | /usr/sbin/sendmail root'
EOF

systemctl daemon-reload
systemctl enable --now update-basemap.timer
systemctl list-timers update-basemap.timer --no-pager
