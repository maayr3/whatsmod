---
description: Automated workflow for deploying to the VM.
---

// turbo-all
1. Run the deployment script on the VM to update code and restart the service.
```bash
ssh ubuntu@mt5 "cd whatsmod && bash deploy.sh"
```
2. Notify the user that deployment is complete.
