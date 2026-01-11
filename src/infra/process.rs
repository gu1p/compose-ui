use std::env;
use std::io;
use std::path::Path;
use std::process::{Child, Command, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};

pub fn command_exists(cmd: &str) -> bool {
    if cmd.contains(std::path::MAIN_SEPARATOR) {
        return Path::new(cmd).is_file();
    }
    if let Ok(path) = env::var("PATH") {
        for entry in env::split_paths(&path) {
            let candidate = entry.join(cmd);
            if candidate.is_file() {
                return true;
            }
        }
    }
    false
}

pub fn run_status(cmd: &[String]) -> bool {
    run_output(cmd)
        .map(|output| output.status.success())
        .unwrap_or(false)
}

pub fn run_output(cmd: &[String]) -> io::Result<Output> {
    let Some((program, args)) = cmd.split_first() else {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "empty command"));
    };
    let mut command = Command::new(program);
    command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command.output()
}

pub fn spawn_process_group(cmd: &mut Command) -> io::Result<Child> {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            cmd.pre_exec(|| {
                if libc::setsid() == -1 {
                    return Err(io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }
    cmd.spawn()
}

pub fn terminate_process(child: &mut Child, timeout: Duration) {
    if child.try_wait().ok().flatten().is_some() {
        return;
    }
    #[cfg(unix)]
    {
        let Ok(pid) = i32::try_from(child.id()) else {
            return;
        };
        unsafe {
            libc::killpg(pid, libc::SIGTERM);
        }
    }
    #[cfg(not(unix))]
    {
        let _ = child.kill();
    }
    if wait_child_timeout(child, timeout) {
        return;
    }
    #[cfg(unix)]
    unsafe {
        if let Ok(pid) = i32::try_from(child.id()) {
            libc::killpg(pid, libc::SIGKILL);
        }
    }
    #[cfg(not(unix))]
    {
        let _ = child.kill();
    }
    let _ = wait_child_timeout(child, Duration::from_secs(1));
}

pub fn wait_child_timeout(child: &mut Child, timeout: Duration) -> bool {
    let start = Instant::now();
    loop {
        if child.try_wait().ok().flatten().is_some() {
            return true;
        }
        if start.elapsed() >= timeout {
            return false;
        }
        thread::sleep(Duration::from_millis(100));
    }
}

pub fn pid_alive(pid: i32) -> bool {
    #[cfg(unix)]
    unsafe {
        if libc::kill(pid, 0) == 0 {
            true
        } else {
            let err = io::Error::last_os_error();
            err.raw_os_error() == Some(libc::EPERM)
        }
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        false
    }
}
