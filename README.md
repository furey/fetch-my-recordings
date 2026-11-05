<p align="center">
  <img src="https://github.com/furey/fetch-my-recordings/releases/download/docs-media/app-icon.png" alt="Fetch My Recordings" width="128"/>
</p>

<h1 align="center">Fetch My Recordings</h1>

<p align="center">
  <strong>Copy the recordings on your Fetch TV box to your computer.</strong><br/>
  A free desktop app for Mac, Windows, and Linux. No Fetch account, no terminal.
</p>

<p align="center">
  <a href="https://github.com/furey/fetch-my-recordings/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/furey/fetch-my-recordings.svg?style=flat-square&color=5ce1c6&label=release"/></a>
  <img alt="Downloads" src="https://img.shields.io/github/downloads/furey/fetch-my-recordings/total.svg?style=flat-square&color=3ba4ff"/>
  <img alt="Mac, Windows, Linux" src="https://img.shields.io/badge/runs%20on-Mac%20%7C%20Windows%20%7C%20Linux-3ba4ff.svg?style=flat-square"/>
  <img alt="License: GPL-3.0-or-later" src="https://img.shields.io/badge/license-GPL--3.0--or--later-f28c28.svg?style=flat-square"/>
  <img alt="Home network only" src="https://img.shields.io/badge/network-home%20only-8d9aa7.svg?style=flat-square"/>
  <img alt="Last commit" src="https://img.shields.io/github/last-commit/furey/fetch-my-recordings.svg?style=flat-square&color=f5c542"/>
</p>

<p align="center">
  <a href="https://furey.github.io/freetvarr/guide/leaving-fetch#save-via-desktop-app"><strong>Download for your computer →</strong></a>
</p>

Prefer a terminal, a NAS, or Docker? See [Related projects](#related-projects).

<https://github.com/user-attachments/assets/9ecbf007-1c77-4009-842c-13fce198e09b>

> [!NOTE]<br>
> Fetch's [Gen 3 Extended Service Levy](https://main.fetchtv.com.au/gen-3-extended-service-levy) asks Mini Gen 3 and Mighty Gen 3 owners to opt in by `30 November 2026`; Fetch suspends boxes from `1 December 2026` if they do not. Copy your recordings while the box still lists them: a box whose Fetch account is cancelled lists no recordings. To record free-to-air TV without Fetch, see [Freetvarr](https://github.com/furey/freetvarr).

## Contents

- [Overview](#overview)
- [Download](#download)
- [Requirements](#requirements)
- [First open](#first-open)
- [Using the app](#using-the-app)
- [Convert to MP4](#convert-to-mp4)
- [Watch on your TV from a USB drive](#watch-on-your-tv-from-a-usb-drive)
- [Built on fetchtv](#built-on-fetchtv)
- [Related projects](#related-projects)
- [Development](#development)
- [Disclaimer](#disclaimer)
- [Contributing](#contributing)
- [Support](#support)

## Overview

<img src="https://github.com/furey/fetch-my-recordings/releases/download/docs-media/app-icon.png" alt="The Fetch My Recordings app icon: three coloured bars in a mint tray" width="96"/>

Fetch My Recordings finds your Fetch box on your home network and copies the recordings you choose to a folder on your computer. You do not need a terminal or a Fetch account.

Fetch My Recordings is an independent, free tool made by a Fetch customer. It is not made, endorsed, or supported by Fetch TV. Fetch is a trademark of its owner.

## Download

The easiest way to download is the [download page](https://furey.github.io/freetvarr/guide/leaving-fetch#save-via-desktop-app), which picks the right file for your computer.

To download a file yourself, choose your computer below. Each link gets the newest version.

| Computer                                  | Download                                                                                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mac (any Mac)                             | [`Fetch-My-Recordings-Mac.dmg`](https://github.com/furey/fetch-my-recordings/releases/latest/download/Fetch-My-Recordings-Mac.dmg)                       |
| Mac with an Apple chip (smaller download) | [`Fetch-My-Recordings-Mac-Apple-Chip.dmg`](https://github.com/furey/fetch-my-recordings/releases/latest/download/Fetch-My-Recordings-Mac-Apple-Chip.dmg) |
| Mac with an Intel chip (smaller download) | [`Fetch-My-Recordings-Mac-Intel.dmg`](https://github.com/furey/fetch-my-recordings/releases/latest/download/Fetch-My-Recordings-Mac-Intel.dmg)           |
| Windows PC                                | [`Fetch-My-Recordings-Windows.exe`](https://github.com/furey/fetch-my-recordings/releases/latest/download/Fetch-My-Recordings-Windows.exe)               |
| Linux                                     | [`Fetch-My-Recordings-Linux.AppImage`](https://github.com/furey/fetch-my-recordings/releases/latest/download/Fetch-My-Recordings-Linux.AppImage)         |
| Linux on ARM (such as a Raspberry Pi)     | [`Fetch-My-Recordings-Linux-ARM.AppImage`](https://github.com/furey/fetch-my-recordings/releases/latest/download/Fetch-My-Recordings-Linux-ARM.AppImage) |

If you are not sure which Mac you have, download the first Mac file; it works on every Mac. To check the chip, open the Apple menu and choose **About This Mac**. A **Chip** line (Apple M1, M2, or later) means an Apple chip. A **Processor** line that says Intel means an Intel chip.

All versions are on the [releases page](https://github.com/furey/fetch-my-recordings/releases).

## Requirements

- **Mac**: macOS 13 Ventura or later, with an Apple chip or an Intel chip.
- **Windows**: Windows 10 or later, 64-bit (x64).
- **Linux**: a 64-bit computer (x86_64 or ARM64) with a major distribution, such as Ubuntu, Fedora, or Debian, in a version that still gets updates.

On an older Mac, use the command-line tool [`fetchtv`](https://github.com/furey/fetchtv) instead. On macOS 12 Monterey, it needs Node.js 22, because Node.js 24 and later need macOS 13.5.

## First open

- [First open overview](#first-open-overview)
- [First open on a Mac](#first-open-on-a-mac)
- [First open on Windows](#first-open-on-windows)
- [First open on Linux](#first-open-on-linux)
- [If the app does not open](#if-the-app-does-not-open)

### First open overview

Fetch My Recordings is free and open source. Anyone can read its code in this repository. Apple and Microsoft charge every year for the certificate that signs an app, so the app is unsigned. Because of this, your computer shows a warning the first time you open it. The steps below show each warning and the button to press.

The app talks only to the Fetch box on your home network. It reads and writes only the folder you choose and its own settings. It deletes nothing from the Fetch box.

> [!NOTE]<br>
> The pictures in the steps below are illustrations of the system messages, not screenshots. The wording on your computer can differ a little.

### First open on a Mac

Your steps depend on your macOS version. To check it, open the Apple menu and choose **About This Mac**. The steps work on a Mac with an Apple chip or an Intel chip.

- [macOS 14 Sonoma and earlier](#mac-macos-14-sonoma-and-earlier)
- [macOS 15 Sequoia and later](#mac-macos-15-sequoia-and-later)
- [Firewall apps](#mac-firewall-apps)

#### Mac: macOS 14 Sonoma and earlier

1. Open the `.dmg` file you downloaded.
2. Drag **Fetch My Recordings** into the **Applications** folder.
3. Open the **Applications** folder and double-click **Fetch My Recordings**.
4. A message says the app cannot be opened because Apple cannot check it for malicious software. Click **OK**.

   <p align="center">
     <img src="https://github.com/furey/fetch-my-recordings/releases/download/docs-media/first-open-mac14-1-cant-open.png" alt="Illustration of the macOS Sonoma message that Fetch My Recordings.app cannot be opened because Apple cannot check it for malicious software, with the OK button marked" width="600"/>
     <br/><em>Illustration: the first macOS message</em>
   </p>

5. Open the Apple menu and choose **System Settings**.
6. Click **Privacy & Security** in the sidebar.
7. Scroll down to the **Security** section.
8. Next to the message that "Fetch My Recordings.app" was blocked from use, click **Open Anyway**.

   <p align="center">
     <img src="https://github.com/furey/fetch-my-recordings/releases/download/docs-media/first-open-mac14-2-open-anyway.png" alt="Illustration of Privacy and Security settings saying Fetch My Recordings.app was blocked from use, with the Open Anyway button marked" width="600"/>
     <br/><em>Illustration: Open Anyway in Privacy &amp; Security</em>
   </p>

9. Type your Mac login password when your Mac asks.
10. Click **Modify Settings**.

    <p align="center">
     <img src="https://github.com/furey/fetch-my-recordings/releases/download/docs-media/first-open-mac14-3-password.png" alt="Illustration of the Mac password prompt with the Modify Settings button marked" width="600"/>
     <br/><em>Illustration: the password prompt</em>
    </p>

11. Click **Open** in the message that appears next.

    <p align="center">
     <img src="https://github.com/furey/fetch-my-recordings/releases/download/docs-media/first-open-mac14-4-open.png" alt="Illustration of the same macOS message with Open, Show in Finder, and Cancel buttons, with the Open button marked" width="600"/>
     <br/><em>Illustration: the second macOS message</em>
    </p>

12. Wait for the app to open.

The **Open Anyway** button stays for about one hour after you first try to open the app. If it is gone, do steps 3 and 4 again, then continue from step 5.

> [!TIP]<br>
> There is a shorter way. Hold the Control key and click **Fetch My Recordings** in the **Applications** folder. Choose **Open**, then click **Open** in the message.

When the app first searches for your Fetch box, your Mac can ask whether Fetch My Recordings can find devices on your local network. Click **Allow**. If you clicked **Don't Allow**, open **System Settings** → **Privacy & Security** → **Local Network**, then turn on **Fetch My Recordings**.

You do these steps once. After that, the app opens with a double-click.

#### Mac: macOS 15 Sequoia and later

1. Open the `.dmg` file you downloaded.
2. Drag **Fetch My Recordings** into the **Applications** folder.
3. Open the **Applications** folder and double-click **Fetch My Recordings**.
4. A message says "Fetch My Recordings" Not Opened. Click **Done**. Do not click **Move to Trash**.

   <p align="center">
     <img src="https://github.com/furey/fetch-my-recordings/releases/download/docs-media/first-open-mac-not-opened.png" alt="Illustration of the macOS message: Fetch My Recordings Not Opened, Apple could not verify it is free of malware, with the Done button marked" width="600"/>
     <br/><em>Illustration: the first macOS message</em>
   </p>

5. Open the Apple menu and choose **System Settings**.
6. Click **Privacy & Security** in the sidebar.
7. Scroll down to the **Security** section.
8. Next to "Fetch My Recordings" was blocked to protect your Mac, click **Open Anyway**.

   <p align="center">
     <img src="https://github.com/furey/fetch-my-recordings/releases/download/docs-media/first-open-mac-privacy-security.png" alt="Illustration of Privacy and Security settings, with the Open Anyway button marked" width="600"/>
     <br/><em>Illustration: Open Anyway in Privacy &amp; Security</em>
   </p>

9. Click **Open Anyway** in the next message.

   <p align="center">
     <img src="https://github.com/furey/fetch-my-recordings/releases/download/docs-media/first-open-mac-open-anyway.png" alt="Illustration of the second macOS message, with the Open Anyway button marked" width="600"/>
     <br/><em>Illustration: the second Open Anyway message</em>
   </p>

10. Type your Mac login password, or use Touch ID, when your Mac asks.
11. Wait for the app to open.

The **Open Anyway** button stays for about one hour after you first try to open the app. If it is gone, do steps 3 and 4 again, then continue from step 5.

When the app first searches for your Fetch box, your Mac asks whether Fetch My Recordings can find devices on your local network. Click **Allow**. The app needs this to find your Fetch box.

<p align="center">
  <img src="https://github.com/furey/fetch-my-recordings/releases/download/docs-media/first-open-mac-local-network.png" alt="Illustration of the macOS question about devices on your local network, with the Allow button marked" width="600"/>
  <br/><em>Illustration: the local network question</em>
</p>

If you clicked **Don't Allow**, open **System Settings** → **Privacy & Security** → **Local Network**, then turn on **Fetch My Recordings**.

If you use a firewall app such as Little Snitch, allow Fetch My Recordings to connect on your local network. If the app found no box while the firewall question was open, click **Search again**.

You do these steps once. After that, the app opens with a double-click.

#### Mac: Firewall apps

If you use a firewall app such as Little Snitch, it can ask about Fetch My Recordings each time it meets a new device on your network. Allow local network connections for Fetch My Recordings, and choose an option that lasts. Otherwise the firewall asks again for every device, and the app can fail to find your Fetch box.

In Little Snitch, choose **Only local network** and a lasting option instead of **Once**, then click **Allow**.

### First open on Windows

Microsoft Edge can stop the download with the message **Fetch-My-Recordings-Windows.exe isn't commonly downloaded. Make sure you trust Fetch-My-Recordings-Windows.exe before you open it.** Edge shows this message for new files that few people have downloaded. To keep the file:

1. In the Edge downloads list, point to the file and click the **...** (More actions) button.
2. Click **Keep**.
3. If Edge asks again, click **Show more**.
4. Click **Keep anyway**.

To open the app after the download:

1. Double-click the `.exe` file you downloaded.
2. If a blue message says Windows protected your PC, click **More info**. If no message appears, go to step 5.

   <p align="center">
     <img src="https://github.com/furey/fetch-my-recordings/releases/download/docs-media/first-open-windows-protected.png" alt="Illustration of the blue Windows protected your PC message, with the More info link marked" width="600"/>
     <br/><em>Illustration: Windows protected your PC</em>
   </p>

3. If you saw the message, check that the **Publisher** line says Unknown publisher.
4. If you saw the message, click **Run anyway**.

   <p align="center">
     <img src="https://github.com/furey/fetch-my-recordings/releases/download/docs-media/first-open-windows-run-anyway.png" alt="Illustration of the same message after More info, with the Run anyway button marked" width="600"/>
     <br/><em>Illustration: the Run anyway button</em>
   </p>

5. Wait for the app to install and open. It installs for your Windows user only, and it is in the Start menu after that.

The first time the app searches for your Fetch box, Windows Security can show a message that asks whether to allow Fetch My Recordings on your networks. Some PCs do not show this message; if yours does not, you have nothing to do here. If the message appears:

1. Tick **Private networks, such as my home or work network**.
2. Leave **Public networks** unticked.
3. Click **Allow access**.

<p align="center">
  <img src="https://github.com/furey/fetch-my-recordings/releases/download/docs-media/first-open-windows-firewall.png" alt="Illustration of the Windows Security Alert for Fetch My Recordings, with Private networks ticked and the Allow access button marked" width="600"/>
  <br/><em>Illustration: the Windows Security Alert</em>
</p>

If you click **Cancel**, the app cannot search for the box. You can still type the IP address of your Fetch box (see [Using the app](#using-the-app)).

### First open on Linux

1. Open your file manager and find the `.AppImage` file you downloaded.
2. Right-click the file and choose **Properties**.
3. Click the **Permissions** tab.
4. Turn on **Allow executing file as program**. Newer versions of GNOME Files call it **Executable as Program**. KDE Dolphin calls it **Is executable**.

   <p align="center">
     <img src="https://github.com/furey/fetch-my-recordings/releases/download/docs-media/first-open-linux-allow-executing.png" alt="Illustration of the file Properties window on the Permissions tab, with Allow executing file as program marked" width="600"/>
     <br/><em>Illustration: Allow executing file as program</em>
   </p>

5. Close the **Properties** window.
6. Double-click the file.

To do the same in a terminal, run these commands in the folder with the file. On Linux on ARM, the file is `Fetch-My-Recordings-Linux-ARM.AppImage`.

```console
chmod +x Fetch-My-Recordings-Linux.AppImage
./Fetch-My-Recordings-Linux.AppImage
```

If the app does not open on Ubuntu 22.04 or later, install FUSE, which every AppImage needs:

- On Ubuntu 22.04, run `sudo apt install libfuse2`.
- On Ubuntu 24.04 or later, run `sudo apt install libfuse2t64`.

If the app still does not open on Ubuntu 24.04 or later, start it from a terminal with `--no-sandbox` after the file name. This turns off Electron's sandbox (a limit on what the app's window can do), so use the option only for this app.

### If the app does not open

If the app shows nothing, check that it is not still running in the background, then open it again:

- On Windows, press **Ctrl+Shift+Esc** to open Task Manager, select **Fetch My Recordings**, and click **End task**.
- On a Mac, open **Activity Monitor**, select **Fetch My Recordings**, and click the **Stop** button in the toolbar, then **Quit**.

On some computers, often ones with extra security software, the app's graphics process cannot start. When that happens before the window shows, the app restarts itself with safer graphics settings. There are two fallback steps: first it turns off hardware acceleration, then it also turns off the sandbox for the graphics process. The app keeps the step that worked until an app update brings a new version of Electron, the framework the app is built on.

On Windows, the installer gives the app's sandboxed processes read access to its install folder. This fixes a folder permission problem that other apps can leave behind ([electron/electron#51761](https://github.com/electron/electron/issues/51761)). If a start closes because of that problem, the next start gives the access again.

Third-party security software, such as Malwarebytes, can stop the app before its window shows. The app is not signed, so this software does not know it. If the app closes with no window, add the install folder to the allow list of your security software (in Malwarebytes, the **Allow List**), then open the app again. The install folder is `%LOCALAPPDATA%\Programs\fetch-my-recordings`.

An old graphics driver can also stop the window from opening. Install the latest driver from the maker of your graphics card (for example NVIDIA, AMD, or Intel), restart the computer, then open the app again.

If the window does not open on two starts in a row, the next start shows a message with the log folder. [Start a thread in Discussions](https://github.com/furey/fetch-my-recordings/discussions) and attach the files `main.log` and `chromium.log` (Windows only) from the log folder:

| Computer | Log folder                                               |
| -------- | -------------------------------------------------------- |
| Mac      | `~/Library/Application Support/Fetch My Recordings/logs` |
| Windows  | `%APPDATA%\Fetch My Recordings\logs`                     |
| Linux    | `~/.config/Fetch My Recordings/logs`                     |

When the app is open, choose **Help** → **Open log folder** to go there. On Windows and Linux, press the **Alt** key to show the menu.

## Using the app

Click **Start** on the welcome screen. The app then takes you through these steps:

1. **Find your Fetch box**: the app searches your home network. If it finds no box, check that the box is on and that your computer is on the same home network, then search again. A VPN can block the search, even with local network access allowed in the VPN app. You can also type the box's IP address, which works with a VPN on: four numbers with dots between them, such as `192.168.1.50`. Find it in your router's list of connected devices, or in the network details of the Fetch box's settings menu.
2. **Choose recordings**: every recording you have not saved before starts ticked. Click **Show** next to a show to tick or untick single episodes. A recording the app cannot save has no tick box. It shows **Still recording** while the box records it, **May still be recording** when the box has not given its size yet, or **File missing on the box** when the box lists it but cannot open its file. Hold the pointer over it to see why.
3. **Choose a folder**: the app shows the free space in the folder and the space the recordings need. Turn on **Names for Plex, Jellyfin or Kodi** if you watch recordings in one of those apps. The files are then saved as `Show/Season 01/Show - S01E02.ts`.
4. **Save**: the app shows the progress of each recording. Your computer stays awake until the save finishes. Click **Stop** at any time.

To go back, click a finished step at the top of the window. The app keeps your box, your ticks, and your folder. Click the app icon in the top-left corner to go back to the welcome screen. While recordings are saving, the earlier steps are locked, and the app icon asks before it stops the save.

<p align="center">
  <img src="https://github.com/furey/fetch-my-recordings/releases/download/docs-media/app-welcome.png" alt="The Fetch My Recordings welcome screen with the Start button" width="720"/>
  <br/><em>The welcome screen</em>
</p>

The app remembers what it saved from each box. On the **Choose recordings** step, a recording you saved before shows **Saved** and starts unticked. A recording shows **Moved or deleted** when its saved file is no longer where the app put it. That recording starts ticked, so **Save** copies it again.

<p align="center">
  <img src="https://github.com/furey/fetch-my-recordings/releases/download/docs-media/app-choose-recordings.png" alt="The Choose recordings step: one episode marked Saved, one marked Moved or deleted, and one new episode with its size" width="720"/>
  <br/><em>Choose recordings, with Saved and Moved or deleted episodes</em>
</p>

When the save ends, the app counts the recordings it saved, the recordings that were already saved, and the recordings it could not save. Click a count to see the list of those recordings. Click **Open folder** to see the files.

<p align="center">
  <img src="https://github.com/furey/fetch-my-recordings/releases/download/docs-media/app-all-done.png" alt="The All done screen: 9 saved, 0 already saved, 0 not saved, and a card that asks I have my files, but now what?" width="720"/>
  <br/><em>The All done screen</em>
</p>

Click **How to watch your recordings** to see how to watch the files on this computer or on your TV.

<p align="center">
  <img src="https://github.com/furey/fetch-my-recordings/releases/download/docs-media/app-how-to-watch.png" alt="The How to watch your recordings dialog on the On your TV tab: a USB drive, an Apple TV, phone or tablet, or Plex, Jellyfin or Kodi" width="720"/>
  <br/><em>How to watch your recordings</em>
</p>

If a save stops part way, or some recordings are not saved, click **Save again**. The app skips the recordings that are already in the folder and continues a part-saved recording from where it stopped. The app keeps its list of saved files in a `fetchtv.json` file in the folder, the same file the [`fetchtv` command-line tool](https://github.com/furey/fetchtv) uses. So the app and `fetchtv` can take turns on one folder.

If the app cannot show the recordings, its message says why:

- **The box did not send its recordings**: the box answered, but not the request for its list of recordings. This does not mean the box has no recordings. Turn the box off at the wall, wait 10 seconds, turn it on again, then click **Try again**.
- **The box is not sharing its recordings**: check the TV. If it shows the Fetch setup or activation screen, the box has lost its Fetch service (the account is cancelled or suspended, or the box cannot reach the internet). The app cannot list the recordings until the box has its Fetch service again.
- **No recordings on this box**: the box answered, and it has no recordings.

The app writes each result to `main.log` in its [log folder](#if-the-app-does-not-open). If you ask for help, attach that file.

## Convert to MP4

The app saves each recording as a `.ts` file, exactly as the Fetch box recorded it. To convert a file is to copy its picture and sound into another kind of video file. MP4 is the kind of video file that most phones, tablets, TVs, and video apps open. You may not need to convert anything:

- **Play them as they are**: VLC (a free video player), Plex, Jellyfin, and Kodi play `.ts` files. On an Apple TV, iPhone, or iPad, use the Infuse or VLC app.
- **HandBrake**: a free app with buttons, from [handbrake.fr](https://handbrake.fr). Choose the **Fast 1080p30** preset for an HD recording, or **Fast 576p25** for an SD recording. It does a full convert (a new picture and new sound), which takes several minutes to an hour or more for each hour of recording.
- **ffmpeg**: a free command-line tool. A fast copy puts an hour of HD into an MP4 file in under a minute from a local drive (longer over Wi-Fi to a NAS), with no loss of quality. The result plays in QuickTime Player on a Mac:

  ```sh
  ffmpeg -fflags +genpts -i "Show - S01E02.ts" -map 0:v:0 -map 0:a -c copy -sn -dn -ignore_unknown -movflags +faststart "Show - S01E02.mp4"
  ```

The Freetvarr guide's [Converting recordings to MP4](https://furey.github.io/freetvarr/guide/leaving-fetch#converting-recordings-to-mp4) has the full steps: how to install ffmpeg on a Mac, Windows, or Linux, a full convert for files that a fast copy cannot play (such as SD channels, or recordings with an extra sound track), and commands that convert a whole folder at once.

> [!WARNING]<br>
> Renaming a `.ts` file to `.mp4` does not convert it. The file inside stays the same, and QuickTime Player will not open it.

> [!WARNING]<br>
> Download video software only from the official sites: VLC from [videolan.org](https://www.videolan.org), HandBrake from [handbrake.fr](https://handbrake.fr), and ffmpeg through Homebrew, `winget`, or your Linux package manager. Search ads and look-alike sites offer "free video converters" that can come with unwanted software or malware.

## Watch on your TV from a USB drive

Many TVs read a USB drive formatted as ExFAT (a drive format that holds files over 4 GB and works on both Mac and Windows). Copy the folder of recordings onto the drive, plug the drive into the TV, and open the drive from the TV's media or USB app. Check your TV's manual for the formats it reads.

- **LG TVs**: LG's [help page](https://www.lg.com/us/support/help-library/lg-tv-viewing-content-on-a-usb-device--20153192465296) says to use FAT32 or NTFS. Some newer models also read ExFAT: the 2021 43UP751C manual says it can read (not write) ExFAT drives, which is enough to play files, and the 2023 UR80 manual lists FAT32, ExFAT, and NTFS. Older models such as the 2016 65UH5C do not read ExFAT, so use NTFS or FAT32 and check your TV's manual.
- **FAT32**: a FAT32 drive cannot hold a file over 4 GB, so it does not suit HD recordings.
- **NTFS**: a Mac cannot write to an NTFS drive without extra software.

> [!WARNING]<br>
> Formatting a drive erases everything on it. Copy off any files you want to keep first.

To format a drive as ExFAT on a Mac:

1. Plug the drive into the Mac and open Disk Utility (in Applications → Utilities).
2. Choose View → Show All Devices.
3. In the sidebar, select the drive itself (the top line, not the volume under it).
4. Press Erase.
5. Set Scheme to Master Boot Record.
6. Set Format to ExFAT.
7. Press Erase.

These steps follow Apple's [Disk Utility guide](https://support.apple.com/guide/disk-utility/dskutl1010/mac).

To format a drive as ExFAT on Windows:

1. Plug the drive into the computer and open File Explorer.
2. Right-click the drive and choose Format.
3. Set File system to exFAT.
4. Press Start.

## Built on fetchtv

The app uses [`fetchtv`](https://github.com/furey/fetchtv), a free command-line tool by the same author, to find Fetch boxes, list recordings, and save them. It imports the [`fetchtv` npm package](https://www.npmjs.com/package/fetchtv), and the build bundles it into the app. A fix to finding, listing, or saving goes into `fetchtv` first, then into a new app release.

Both write the same `fetchtv.json` file in the save folder, so the app skips recordings that `fetchtv` saved, and `fetchtv` skips recordings that the app saved.

## Related projects

- [`fetchtv`](https://github.com/furey/fetchtv): the command-line tool this app is built on, for a terminal, a NAS, or Docker.
- [Freetvarr](https://furey.github.io/freetvarr/) ([repository](https://github.com/furey/freetvarr)): a free app by the same author that records free-to-air TV without Fetch, with a TV tuner on your home network.

## Development

- [Development overview](#development-overview)
- [Commands](#commands)
- [Demo video](#demo-video)
- [Build workflow](#build-workflow)

### Development overview

Fetch My Recordings is an [Electron](https://www.electronjs.org) app. `scripts/bundle.mjs` bundles `src/main.js` and `fetchtv` into `dist/main.mjs` with esbuild, and copies the window's files from `src/renderer` into `dist`. Node.js `22` or later is required.

```console
git clone https://github.com/furey/fetch-my-recordings.git
cd fetch-my-recordings
npm ci
npm start
```

To try the app without a Fetch box, run `npm run fake-box` in a second terminal. It starts a pretend Fetch box with made-up shows on port `49152`. The pretend box acts like a real one: it overstates each file's size, resets the connection at the end, and answers a resume with `416`. It also answers the app's search, or you can type `127.0.0.1` as the IP address. Add `--empty` for a box with no recordings, or `--mb-per-second=2` for a slow box.

### Commands

| Command              | Effect                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm start`          | Bundles the app and opens it                                                                             |
| `npm test`           | Runs the unit tests, which open no windows                                                               |
| `npm run test:e2e`   | Bundles the app, then runs the end-to-end tests, which open the app and drive it against the pretend box |
| `npm run dist`       | Builds the app for the computer you run it on, into `release`                                            |
| `npm run dist:mac`   | Builds the macOS `.dmg` files (any Mac, Apple chip, and Intel)                                           |
| `npm run dist:win`   | Builds the Windows installer                                                                             |
| `npm run dist:linux` | Builds the Linux AppImages (`x86_64` and `arm64`)                                                        |

The end-to-end tests open app windows, which take the keyboard focus while they run. The [build workflow](#build-workflow) runs them on macOS, Windows, and Linux.

The end-to-end tests include a search for the pretend box over the network (SSDP). Set `FETCHTV_E2E_SKIP_SSDP=1` to skip that test when a firewall blocks it, for example Little Snitch on a Mac.

### Demo video

[`scripts/record-demo.mjs`](./scripts/record-demo.mjs) records the demo video at the top of this README. It starts a pretend box with demo shows, drives the app, and joins the frames, cursor, and sounds into an MP4 file with `ffmpeg`. Run `npm run bundle` first, then:

```console
node scripts/record-demo.mjs --out /tmp/demo --mp4 /tmp/demo/demo.mp4 --poster /tmp/demo/poster.png
```

Add `--executable <path>` to record a built app instead of the source.

To check that the video plays at a true 60 fps, with a cursor that moves on every frame and never holds or jumps:

```console
node scripts/check-frame-timing.mjs --mp4 /tmp/demo/demo.mp4 --out /tmp/demo
```

### Build workflow

[`build.yml`](./.github/workflows/build.yml) runs on a push to `main` or `develop`, a version tag, a pull request, or by hand. On macOS, Windows, and Ubuntu runners it runs `npm test`, then `npm run test:e2e` (under `xvfb` on Ubuntu), and builds the app with `electron-builder`. The builds are kept as workflow artefacts.

For a pushed version tag (e.g. `1.0.0`), a second job waits up to 30 minutes for the GitHub release of that tag. It then attaches these files to the release, and no others:

- `Fetch-My-Recordings-Mac.dmg` (any Mac)
- `Fetch-My-Recordings-Mac-Apple-Chip.dmg`
- `Fetch-My-Recordings-Mac-Intel.dmg`
- `Fetch-My-Recordings-Windows.exe`
- `Fetch-My-Recordings-Linux.AppImage` (`x86_64`)
- `Fetch-My-Recordings-Linux-ARM.AppImage` (`arm64`)

Only that job can write to the repository.

## Disclaimer

This project:

- Is licensed under the [GNU GPLv3 License](./LICENSE.txt). The GitHub mark is from [GitHub Octicons](https://github.com/primer/octicons) (MIT licence, [`src/renderer/licences/octicons-MIT.txt`](./src/renderer/licences/octicons-MIT.txt)). The Figtree and Geist Mono fonts are under the SIL Open Font Licence 1.1 (in [`src/renderer/fonts`](./src/renderer/fonts)).
- Is not made, endorsed, or supported by Fetch TV.
- Is written with the assistance of AI and may contain errors.
- Is provided as-is with no warranty. Use it at your own risk.

## Contributing

If you hit a problem or want to compare notes, start a thread in [Discussions](https://github.com/furey/fetch-my-recordings/discussions).

## Support

If you've found this project helpful, consider supporting my work through:

[Buy Me a Coffee](https://www.buymeacoffee.com/furey) | [GitHub Sponsorship](https://github.com/sponsors/furey)
