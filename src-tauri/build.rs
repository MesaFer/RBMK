use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    // Tauri build
    tauri_build::build();
    
    // Get the output directory
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    
    // Compile Fortran code to DLL
    let fortran_src = manifest_dir.join("..").join("fortran").join("rbmk_physics.f90");
    let dll_path = out_dir.join("rbmk_physics.dll");
    
    println!("cargo:rerun-if-changed=../fortran/rbmk_physics.f90");
    
    // Use MSYS2 shell to run gfortran (ensures proper DLL loading)
    let msys2_shell = "C:\\msys64\\msys2_shell.cmd";
    
    // Build the gfortran command to create a shared library (DLL)
    let fortran_src_str = fortran_src.to_str().unwrap().replace("\\", "/");
    let dll_path_str = dll_path.to_str().unwrap().replace("\\", "/");
    
    // Compile to DLL with all dependencies statically linked
    let gfortran_cmd = format!(
        "gfortran -shared -O3 -static -static-libgfortran -static-libgcc '{}' -o '{}'",
        fortran_src_str, dll_path_str
    );
    
    println!("cargo:warning=Running: {}", gfortran_cmd);
    
    let output = Command::new(msys2_shell)
        .args(&[
            "-defterm",
            "-here",
            "-no-start",
            "-ucrt64",
            "-c",
            &gfortran_cmd,
        ])
        .output();
    
    match output {
        Ok(out) => {
            println!("cargo:warning=gfortran exit status: {}", out.status);
            if !out.stdout.is_empty() {
                println!("cargo:warning=stdout: {}", String::from_utf8_lossy(&out.stdout));
            }
            if !out.stderr.is_empty() {
                println!("cargo:warning=stderr: {}", String::from_utf8_lossy(&out.stderr));
            }
            if !out.status.success() {
                panic!("Fortran DLL compilation failed!");
            }
        }
        Err(e) => {
            println!("cargo:warning=Failed to run MSYS2 shell: {}", e);
            panic!("Failed to run MSYS2 shell: {}", e);
        }
    }
    
    // Copy DLL to target directory so it can be found at runtime
    // Note: We only copy to target/debug, NOT to src-tauri to avoid infinite rebuild loop
    let target_dir = manifest_dir.join("target").join("debug");
    
    // Create target/debug if it doesn't exist
    std::fs::create_dir_all(&target_dir).ok();
    
    // Copy DLL to target/debug
    let dll_dest = target_dir.join("rbmk_physics.dll");
    if let Err(e) = std::fs::copy(&dll_path, &dll_dest) {
        println!("cargo:warning=Failed to copy DLL to debug dir: {}", e);
    } else {
        println!("cargo:warning=Copied DLL to: {}", dll_dest.display());
    }
    
    // Set environment variable for the DLL path
    println!("cargo:rustc-env=RBMK_DLL_PATH={}", dll_path.display());
}
