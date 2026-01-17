use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    // Tauri build
    tauri_build::build();
    
    // Get the output directory
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let fortran_dir = manifest_dir.join("..").join("fortran");
    
    // List of Fortran source files in compilation order (dependencies first)
    let fortran_sources = [
        "rbmk_constants.f90",
        "rbmk_kinetics.f90",
        "rbmk_reactivity.f90",
        "rbmk_thermal.f90",
        "rbmk_xenon.f90",
        "rbmk_neutronics.f90",
        "rbmk_safety.f90",
        "rbmk_spatial.f90",      // 2D spatial physics with diffusion
        "rbmk_simulation.f90",
    ];
    
    // Rerun if any Fortran file changes
    for src in &fortran_sources {
        println!("cargo:rerun-if-changed=../fortran/{}", src);
    }
    
    let dll_path = out_dir.join("rbmk_physics.dll");
    
    // Use MSYS2 shell to run gfortran (ensures proper DLL loading)
    let msys2_shell = "C:\\msys64\\msys2_shell.cmd";
    
    // Build the list of source files for gfortran
    let fortran_src_list: Vec<String> = fortran_sources
        .iter()
        .map(|src| {
            let path = fortran_dir.join(src);
            format!("'{}'", path.to_str().unwrap().replace("\\", "/"))
        })
        .collect();
    
    let dll_path_str = dll_path.to_str().unwrap().replace("\\", "/");
    
    // Compile all modules to DLL with all dependencies statically linked
    // Order matters: dependencies must come before modules that use them
    let gfortran_cmd = format!(
        "gfortran -shared -O3 -static -static-libgfortran -static-libgcc {} -o '{}'",
        fortran_src_list.join(" "),
        dll_path_str
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
