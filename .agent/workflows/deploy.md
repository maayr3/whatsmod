---
description: Automated workflow for deploying to the VM.
---

// turbo-all
1. Run the deployment script on the VM (host: `edgewonk_cli`, configured in `/etc/hosts`) to update code and restart the service.
```bash
ssh ubuntu@edgewonk_cli "cd whatsmod && bash deploy.sh"
```
2. Notify the user that deployment is complete.
