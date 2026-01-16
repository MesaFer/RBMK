! =============================================================================
! RBMK Constants Module
! Physical and reactor-specific constants
! =============================================================================

module rbmk_constants
    use iso_c_binding
    implicit none
    
    ! Physical constants
    real(c_double), parameter :: NEUTRON_LIFETIME = 1.0d-3      ! Prompt neutron lifetime [s]
    real(c_double), parameter :: BETA_EFF = 0.0065d0            ! Effective delayed neutron fraction
    real(c_double), parameter :: LAMBDA_DECAY = 0.0767d0        ! Decay constant for delayed neutrons [1/s]
    
    ! Xenon/Iodine constants
    real(c_double), parameter :: SIGMA_XE = 2.65d-18            ! Xenon-135 absorption cross-section [cm^2]
    real(c_double), parameter :: LAMBDA_XE = 2.09d-5            ! Xenon-135 decay constant [1/s]
    real(c_double), parameter :: LAMBDA_I = 2.87d-5             ! Iodine-135 decay constant [1/s]
    real(c_double), parameter :: GAMMA_I = 0.061d0              ! Iodine-135 fission yield
    real(c_double), parameter :: GAMMA_XE = 0.003d0             ! Direct Xenon-135 fission yield
    real(c_double), parameter :: SIGMA_F = 0.0025d0             ! Fission cross-section [1/cm]
    
    ! RBMK-1000 specific parameters
    real(c_double), parameter :: CORE_HEIGHT = 700.0d0          ! Active core height [cm]
    real(c_double), parameter :: CORE_RADIUS = 593.0d0          ! Core radius [cm]
    integer(c_int), parameter :: NUM_CHANNELS = 1661            ! Number of fuel channels
    real(c_double), parameter :: NOMINAL_POWER = 3200.0d0       ! Nominal thermal power [MW]
    
    ! Diffusion parameters (typical values for graphite-moderated reactor)
    real(c_double), parameter :: D_COEFF = 0.84d0               ! Diffusion coefficient [cm]
    real(c_double), parameter :: SIGMA_A = 0.0034d0             ! Macroscopic absorption cross-section [1/cm]
    real(c_double), parameter :: NU_SIGMA_F = 0.0041d0          ! Nu * fission cross-section [1/cm]
    
    ! Temperature feedback coefficients
    real(c_double), parameter :: ALPHA_FUEL = -5.0d-5           ! Fuel temperature coefficient [1/K] - NEGATIVE (Doppler)
    real(c_double), parameter :: ALPHA_VOID = 2.925d-4          ! Void coefficient [1/%void] = 4.5*BETA_EFF/100 - POSITIVE!
    real(c_double), parameter :: ALPHA_GRAPHITE = 1.0d-5        ! Graphite temperature coefficient [1/K] - POSITIVE
    
    ! Reference temperatures
    real(c_double), parameter :: REF_FUEL_TEMP = 900.0d0        ! Reference fuel temperature [K]
    real(c_double), parameter :: REF_GRAPHITE_TEMP = 650.0d0    ! Reference graphite temperature [K]
    real(c_double), parameter :: SATURATION_TEMP = 558.0d0      ! Coolant saturation temperature at 7 MPa [K]
    
    ! Thermal time constants
    real(c_double), parameter :: COOLANT_TIME_CONST = 3.0d0     ! Coolant response time [s]
    real(c_double), parameter :: GRAPHITE_TIME_CONST = 60.0d0   ! Graphite response time [s] - large thermal mass
    real(c_double), parameter :: VOID_TIME_CONST = 2.0d0        ! Void formation time [s]
    
    ! Base excess reactivity (reactor is supercritical without rods)
    real(c_double), parameter :: BASE_REACTIVITY = 0.0975d0
    
    ! Explosion detection thresholds
    real(c_double), parameter :: FUEL_MELTING_POINT = 2800.0d0  ! K - UO2 melting temperature
    real(c_double), parameter :: CRITICAL_VOID_FRACTION = 75.0d0 ! % - near-complete voiding
    real(c_double), parameter :: CRITICAL_COOLANT_TEMP = 700.0d0 ! K - well above saturation
    real(c_double), parameter :: PROMPT_SUPERCRITICAL = 1.0d0   ! $ - prompt critical threshold
    real(c_double), parameter :: EXTREME_POWER_FACTOR = 3.0d0   ! Power > 300% nominal
    real(c_double), parameter :: EXPLOSION_THRESHOLD = 1.0d0    ! Severity threshold for explosion
    
    ! SCRAM parameters
    real(c_double), parameter :: ROD_DROP_TIME = 2.5d0          ! Time for full rod insertion [s]
    
end module rbmk_constants
