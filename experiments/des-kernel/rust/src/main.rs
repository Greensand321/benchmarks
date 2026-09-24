use std::time::Instant;

fn main() {
    let args: Vec<u32> = std::env::args().skip(1).map(|s| s.parse().unwrap()).collect();
    let (g, n, seed) = (args[0], args[1], args.get(2).copied().unwrap_or(1));
    let t0 = Instant::now();
    let r = des_kernel::simulate(g, n, seed);
    let ms = t0.elapsed().as_secs_f64() * 1000.0;
    println!(
        "{{\"engine\":\"rust-native\",\"g\":{},\"agents\":{},\"events\":{},\"trips\":{},\"hash\":\"{:08x}\",\"ms\":{:.1}}}",
        g, n, r.events, r.trips, r.hash, ms
    );
}
