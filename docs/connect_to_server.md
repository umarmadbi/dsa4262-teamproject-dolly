# Connecting to the team AWS machine

| | |
|---|---|
| Machine address | `dsa4262-2610-teamproject-dolly.nus.cloud` |
| Username | `ubuntu` |
| Key file | `dsa4262-2610-teamproject-dolly.pem` (shared privately within the team) |
| OS | Ubuntu 24.04 LTS |

> **Never commit the `.pem` file or share it outside the team.** Anyone who has it can log in to our machine and spend our budget. `.gitignore` blocks `*.pem`, but keep it outside the repo folder anyway.

The machine must be **running** in Ronin (https://ronin.nus.cloud) before you can connect. If it is stopped, start it from the Ronin dashboard and wait a minute or two.

---

## 1. Put the key in place (once)

### Windows (PowerShell)
```powershell
mkdir $HOME\.ssh -Force
move $HOME\Downloads\dsa4262-2610-teamproject-dolly.pem $HOME\.ssh\

# Windows equivalent of chmod: only you may read the key
icacls $HOME\.ssh\dsa4262-2610-teamproject-dolly.pem /inheritance:r /grant:r "$($env:USERNAME):R"
```

### macOS / Linux / WSL
```bash
mkdir -p ~/.ssh
mv ~/Downloads/dsa4262-2610-teamproject-dolly.pem ~/.ssh/
chmod 400 ~/.ssh/dsa4262-2610-teamproject-dolly.pem
```

If ssh later says **"UNPROTECTED PRIVATE KEY FILE"**, the permission step above was skipped.

## 2. Create a shortcut (once)

Create or edit the file `~/.ssh/config` (on Windows: `C:\Users\<you>\.ssh\config`, plain text, no extension) and add:

```
Host dolly
    HostName dsa4262-2610-teamproject-dolly.nus.cloud
    User ubuntu
    IdentityFile ~/.ssh/dsa4262-2610-teamproject-dolly.pem
    ServerAliveInterval 60
```

## 3. Connect

```bash
ssh dolly
```

(Without the shortcut: `ssh -i ~/.ssh/dsa4262-2610-teamproject-dolly.pem ubuntu@dsa4262-2610-teamproject-dolly.nus.cloud`.)

The first time, type `yes` to trust the machine. You are in when the prompt shows `ubuntu@ip-...:~$`.

## 4. Recommended: VS Code Remote-SSH

1. Install VS Code and the **Remote - SSH** extension.
2. `Ctrl+Shift+P` → **Remote-SSH: Connect to Host…** → `dolly`.
3. **File → Open Folder** → `/home/ubuntu/<yourname>/dsa4262-teamproject-dolly`.
4. Install the **Python** and **Jupyter** extensions *on the remote* when VS Code offers.

You now edit files, run notebooks and use the terminal on the server as if it were local. Your code and data never leave AWS.

---

## Working on a shared machine

We all log in as the same `ubuntu` user, so follow these rules to avoid stepping on each other:

- **Your own folder:** clone the repo into `~/<yourname>/` (see [team_guide.md](team_guide.md)). Don't edit files in someone else's folder.
- **Shared data:** the datasets live once in `~/data/` and are read-only by convention. Link them into your clone with `ln -s`; don't copy or modify them.
- **Git identity per clone:** run `git config user.name` / `user.email` inside your clone **without `--global`**.
- **GitHub login on the server:** when you push over HTTPS, VS Code shows a GitHub sign-in prompt in your browser. In a plain terminal, use a GitHub *personal access token* as the password (GitHub → Settings → Developer settings → Fine-grained tokens, access to this repo only). Don't save someone else's token on the machine.
- **Memory:** the machine has 8 GB of RAM shared by everyone. Check with `htop` or `free -h` before starting a big job, and tell the team chat when you run something heavy.

## Long-running jobs

Use `screen` so a job keeps running after you disconnect:

```bash
screen -S train            # start a named session
source .venv/bin/activate
python scripts/parse_to_parquet.py data/data0/dataset0.json.gz results/d0_sites.parquet
# press Ctrl+A then D to detach; you can now log out
screen -ls                 # list sessions
screen -r train            # reattach later
```

## Moving files between your laptop and the server

Run these **on your laptop**, not in the server terminal.

```bash
# laptop -> server (upload is free)
scp -r "path/to/Team Project/data0" dolly:~/data/

# server -> laptop (download from AWS is charged, keep it small: figures, CSVs)
scp dolly:~/<yourname>/dsa4262-teamproject-dolly/results/roc_pr.png .
```

## Saving money

| Action | When | Effect |
|---|---|---|
| **Stop** | Every time you finish (evenings, weekends) | Compute charges stop; disk is still charged; everything is kept |
| **Change machine type** | Need more CPU/RAM for a big run | Stop → change type in Ronin → start; scale back down afterwards |
| **Terminate** | Only at the very end | Deletes the machine **and its disk**; back up anything you need to GitHub first |

Check with the team before stopping the machine, in case someone is running a job (`screen -ls`, `htop`).
