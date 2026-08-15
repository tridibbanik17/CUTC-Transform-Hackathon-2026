"""
Generate synthetic demo PDFs for CourseChat.
These are self-authored placeholder materials for a fictional
"CS 2XY3 - Operating Systems" course so judges can test the extension
without requiring real copyrighted university content.
"""

from fpdf import FPDF
from pathlib import Path
import os

OUTPUT_DIR = Path(__file__).parent


def make_pdf(filename: str, title: str, pages: list[dict]):
    """Create a PDF with given title and pages of content."""
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=20)

    for page in pages:
        pdf.add_page()
        # Page heading
        pdf.set_font("Helvetica", "B", 16)
        pdf.cell(0, 12, page["heading"], new_x="LMARGIN", new_y="NEXT")
        pdf.ln(4)
        # Body text
        pdf.set_font("Helvetica", "", 11)
        for paragraph in page["content"]:
            if paragraph.startswith("##"):
                pdf.set_font("Helvetica", "B", 13)
                pdf.ln(4)
                pdf.cell(0, 8, paragraph.replace("## ", ""), new_x="LMARGIN", new_y="NEXT")
                pdf.set_font("Helvetica", "", 11)
            else:
                pdf.multi_cell(0, 6, paragraph)
                pdf.ln(3)

    out_path = OUTPUT_DIR / filename
    pdf.output(str(out_path))
    print(f"  Created: {out_path.name} ({len(pages)} pages)")


def main():
    # Clean existing PDFs
    for f in OUTPUT_DIR.rglob("*.pdf"):
        os.remove(f)
    # Remove empty subdirs content
    for subdir in ["Lectures", "Assignments", "Quiz_Problems", "Quiz_Solutions"]:
        (OUTPUT_DIR / subdir).mkdir(exist_ok=True)

    print("Generating demo PDFs for CS 2XY3 - Operating Systems...\n")

    # ===== LECTURES =====
    make_pdf("Lectures/lec1_intro_to_os.pdf", "Lecture 1: Introduction to Operating Systems", [
        {
            "heading": "Lecture 1: Introduction to Operating Systems",
            "content": [
                "## What is an Operating System?",
                "An operating system (OS) is system software that manages computer hardware and software resources and provides common services for computer programs. It acts as an intermediary between users and the computer hardware.",
                "The OS performs several critical functions: process management, memory management, file system management, I/O device management, and security/protection.",
                "## Types of Operating Systems",
                "Batch Operating Systems: Jobs are grouped and executed sequentially without user interaction during execution. Early mainframe computers used this approach.",
                "Time-Sharing Systems: Multiple users share system resources simultaneously. The CPU switches between tasks rapidly, giving each user the illusion of dedicated access.",
                "Real-Time Operating Systems (RTOS): Designed for applications requiring guaranteed response times. Used in embedded systems, medical devices, and industrial control.",
                "Distributed Operating Systems: Manage a collection of independent computers that appear to users as a single coherent system.",
            ]
        },
        {
            "heading": "Lecture 1 (cont.): OS Structure",
            "content": [
                "## Monolithic Kernel",
                "In a monolithic kernel architecture, the entire OS runs as a single program in kernel mode. All OS services run in kernel space, providing fast system calls but making the system harder to maintain and debug.",
                "Examples: Linux, traditional UNIX systems.",
                "## Microkernel Architecture",
                "A microkernel keeps only the most essential services (IPC, basic scheduling, memory management) in kernel space. Other services (file systems, drivers, networking) run as user-space processes.",
                "Advantages: better fault isolation, easier to extend. Disadvantages: potential performance overhead from IPC.",
                "Examples: Minix, QNX, L4 family.",
                "## Hybrid Kernel",
                "Combines aspects of monolithic and microkernel designs. Core services run in kernel mode for performance, but the system is modular enough to load/unload components dynamically.",
                "Examples: Windows NT, macOS (XNU kernel).",
            ]
        },
    ])

    make_pdf("Lectures/lec2_processes_threads.pdf", "Lecture 2: Processes and Threads", [
        {
            "heading": "Lecture 2: Processes and Threads",
            "content": [
                "## Process Concept",
                "A process is a program in execution. It includes the program code (text section), current activity (program counter, registers), stack (temporary data), data section (global variables), and heap (dynamically allocated memory).",
                "Process states: New, Ready, Running, Waiting, Terminated.",
                "## Process Control Block (PCB)",
                "The PCB contains all information about a process: process state, program counter, CPU registers, CPU scheduling information, memory management info, I/O status, and accounting information.",
                "The PCB is the kernel's representation of a process. Context switches save/restore PCB contents.",
                "## Threads",
                "A thread is the basic unit of CPU utilization. It comprises a thread ID, program counter, register set, and stack. Threads within the same process share code, data, and OS resources.",
                "Benefits of multithreading: responsiveness, resource sharing, economy (cheaper than creating new processes), and scalability on multiprocessor systems.",
            ]
        },
        {
            "heading": "Lecture 2 (cont.): Scheduling",
            "content": [
                "## CPU Scheduling Algorithms",
                "First-Come, First-Served (FCFS): Simple but can cause the convoy effect where short processes wait behind long ones. Non-preemptive.",
                "Shortest Job First (SJF): Optimal for minimizing average waiting time, but requires knowledge of future burst lengths. Can be preemptive (SRTF) or non-preemptive.",
                "Round Robin (RR): Each process gets a small time quantum (10-100ms). After the quantum expires, the process is preempted and moved to the end of the ready queue. Good for time-sharing systems.",
                "Priority Scheduling: Each process has a priority. Higher priority processes run first. Can suffer from starvation of low-priority processes. Solution: aging.",
                "## Context Switching",
                "A context switch saves the state of the old process and loads the saved state of the new process. This is pure overhead (no useful work done). Typical cost: 1-10 microseconds on modern hardware.",
            ]
        },
    ])

    # ===== ASSIGNMENTS =====
    make_pdf("Assignments/ps1_processes.pdf", "Problem Set 1: Processes and Scheduling", [
        {
            "heading": "CS 2XY3 - Problem Set 1: Processes and Scheduling",
            "content": [
                "Due: Week 3. Submit via your LMS.",
                "## Question 1 (15 points)",
                "Explain the difference between a process and a thread. Give two advantages of using threads over creating multiple processes for a web server handling concurrent requests.",
                "## Question 2 (20 points)",
                "Consider the following set of processes with their arrival times and CPU burst lengths:",
                "Process P1: Arrival=0, Burst=8ms\nProcess P2: Arrival=1, Burst=4ms\nProcess P3: Arrival=2, Burst=9ms\nProcess P4: Arrival=3, Burst=5ms",
                "(a) Draw Gantt charts for FCFS, SJF (non-preemptive), and Round Robin (quantum=3ms) scheduling.",
                "(b) Calculate the average waiting time and average turnaround time for each algorithm.",
                "(c) Which algorithm gives the best average waiting time for this workload? Explain why.",
                "## Question 3 (15 points)",
                "What is the convoy effect in FCFS scheduling? Provide a concrete example with 4 processes that demonstrates this problem, and explain how SJF avoids it.",
            ]
        },
    ])

    make_pdf("Assignments/ps2_memory.pdf", "Problem Set 2: Memory Management", [
        {
            "heading": "CS 2XY3 - Problem Set 2: Memory Management",
            "content": [
                "Due: Week 6. Submit via your LMS.",
                "## Question 1 (20 points)",
                "Consider a logical address space of 256 pages with a 4-KB page size, mapped onto a physical memory of 128 frames.",
                "(a) How many bits are required for the logical address?",
                "(b) How many bits are required for the physical address?",
                "(c) What is the size of the page table if each entry contains the frame number plus 3 protection bits?",
                "## Question 2 (15 points)",
                "Explain the difference between internal fragmentation and external fragmentation. Which type of fragmentation does paging eliminate? Which does segmentation suffer from?",
                "## Question 3 (15 points)",
                "A system uses a two-level page table. The virtual address is 32 bits, page size is 4 KB, and each page table entry is 4 bytes. Calculate: (a) the number of entries in the inner page table, (b) the number of entries in the outer page table, (c) the total memory overhead if only 3 inner tables are actually used.",
            ]
        },
    ])

    # ===== QUIZ PROBLEMS =====
    make_pdf("Quiz_Problems/midterm_problems.pdf", "Midterm Exam - Problems", [
        {
            "heading": "CS 2XY3 Midterm Exam (Problems)",
            "content": [
                "Time: 90 minutes. Total: 60 points. Answer all questions.",
                "## Question 1 (10 points) - OS Fundamentals",
                "(a) List three responsibilities of an operating system. (3 pts)",
                "(b) Compare and contrast monolithic kernels and microkernels. Give one advantage and one disadvantage of each. (4 pts)",
                "(c) What is a system call? Give two examples. (3 pts)",
                "## Question 2 (15 points) - Process Scheduling",
                "Five processes arrive at time 0 with the following burst times: P1=10, P2=3, P3=7, P4=1, P5=5.",
                "(a) Calculate average waiting time for SJF scheduling. (5 pts)",
                "(b) Calculate average waiting time for Round Robin with quantum=4. (5 pts)",
                "(c) Does Round Robin always outperform FCFS? Justify your answer. (5 pts)",
                "## Question 3 (15 points) - Memory",
                "A system has 32-bit virtual addresses, 4-KB pages, and 512 MB of physical RAM.",
                "(a) How many virtual pages exist? (3 pts)",
                "(b) How many physical frames exist? (3 pts)",
                "(c) If 8 bits per page table entry are used for protection/status, how large is a single-level page table? (4 pts)",
                "(d) Why might a multi-level page table be preferred? (5 pts)",
                "## Question 4 (20 points) - Synchronization",
                "(a) What is a race condition? Give a concrete example with two threads incrementing a shared counter. (5 pts)",
                "(b) Implement a solution to the bounded-buffer problem using semaphores. Show pseudocode for both producer and consumer. (10 pts)",
                "(c) What is priority inversion? Describe one technique to mitigate it. (5 pts)",
            ]
        },
    ])

    make_pdf("Quiz_Problems/final_problems.pdf", "Final Exam - Problems", [
        {
            "heading": "CS 2XY3 Final Exam (Problems)",
            "content": [
                "Time: 150 minutes. Total: 100 points. Answer all questions.",
                "## Question 1 (20 points) - Deadlocks",
                "(a) State all four necessary conditions for deadlock. (4 pts)",
                "(b) Given a resource allocation graph with processes P1-P4 and resources R1-R3 where: P1 holds R1 and requests R2; P2 holds R2 and requests R3; P3 holds R3 and requests R1; P4 requests R2. Is there a deadlock? Identify the cycle. (8 pts)",
                "(c) Describe the Banker's Algorithm. What information does it require? (8 pts)",
                "## Question 2 (20 points) - File Systems",
                "(a) Compare contiguous, linked, and indexed file allocation methods. Give one advantage and one disadvantage of each. (9 pts)",
                "(b) A file system uses 4-KB blocks and 4-byte block pointers. An inode has 12 direct pointers, 1 single-indirect, 1 double-indirect, and 1 triple-indirect pointer. What is the maximum file size? (11 pts)",
                "## Question 3 (20 points) - Virtual Memory",
                "(a) Explain the page replacement process when a page fault occurs. (5 pts)",
                "(b) Given reference string: 7,0,1,2,0,3,0,4,2,3,0,3,2 with 3 frames, calculate page faults for FIFO and LRU. (10 pts)",
                "(c) What is thrashing and what causes it? (5 pts)",
                "## Question 4 (20 points) - I/O and Disk",
                "(a) Calculate the average seek time for SCAN (elevator) disk scheduling given head position 53 and request queue: 98, 183, 37, 122, 14, 124, 65, 67 (moving toward 0 first). (10 pts)",
                "(b) What is DMA and why is it important for I/O performance? (5 pts)",
                "(c) Compare programmed I/O, interrupt-driven I/O, and DMA. (5 pts)",
                "## Question 5 (20 points) - Protection and Security",
                "(a) Explain the difference between authentication and authorization. (4 pts)",
                "(b) What is an access control matrix? How do access control lists (ACLs) and capabilities relate to it? (8 pts)",
                "(c) Describe two types of security threats (e.g., buffer overflow, Trojan horse) and one mitigation technique for each. (8 pts)",
            ]
        },
    ])

    # ===== QUIZ SOLUTIONS =====
    make_pdf("Quiz_Solutions/midterm_solutions.pdf", "Midterm Exam - Solutions", [
        {
            "heading": "CS 2XY3 Midterm Exam (Solutions)",
            "content": [
                "## Question 1 Solutions",
                "(a) Three OS responsibilities: (1) Process management - creating, scheduling, terminating processes. (2) Memory management - allocating/deallocating memory, virtual memory. (3) File system management - creating, deleting, organizing files and directories.",
                "(b) Monolithic kernel: entire OS in one large binary in kernel space. Advantage: fast (no IPC overhead for internal calls). Disadvantage: a bug in any component can crash the whole system. Microkernel: minimal kernel with services in user space. Advantage: better fault isolation (a crashed driver doesn't crash the kernel). Disadvantage: IPC overhead for service communication.",
                "(c) A system call is the programmatic interface between a user process and the OS kernel. Examples: open() to open a file, fork() to create a new process.",
                "## Question 2 Solutions",
                "(a) SJF order: P4(1), P2(3), P5(5), P3(7), P1(10). Waiting times: P4=0, P2=1, P5=4, P3=9, P1=16. Average = (0+1+4+9+16)/5 = 6.0 ms.",
                "(b) Round Robin (q=4): P1(4)|P2(3)|P3(4)|P4(1)|P5(4)|P1(4)|P3(3)|P5(1)|P1(2). Waiting: P1=16, P2=4, P3=14, P4=9, P5=13. Average = (16+4+14+9+13)/5 = 11.2 ms.",
                "(c) No. RR does not always outperform FCFS. When all processes have similar burst times, RR introduces context switch overhead without benefit. FCFS has no preemption overhead. RR excels with varied burst lengths where short jobs shouldn't wait behind long ones.",
                "## Question 3 Solutions",
                "(a) Virtual pages = 2^32 / 2^12 = 2^20 = 1,048,576 pages.",
                "(b) Physical frames = 512 MB / 4 KB = 2^29 / 2^12 = 2^17 = 131,072 frames.",
                "(c) Each PTE needs: 17 bits (frame number for 2^17 frames) + 8 bits (protection) = 25 bits, rounded to 4 bytes. Table size = 2^20 entries x 4 bytes = 4 MB.",
                "(d) Multi-level preferred because most processes use only a small portion of their address space. A single-level table wastes 4 MB per process even if only a few pages are used. Multi-level allocates inner tables on demand.",
                "## Question 4 Solutions",
                "(a) A race condition occurs when the outcome depends on the non-deterministic timing of concurrent operations on shared data. Example: two threads both read counter=5, both increment to 6, both write 6. Result is 6 instead of 7 - one increment is lost.",
                "(b) Bounded buffer with semaphores:\n  semaphore mutex = 1 (binary)\n  semaphore empty = N (counting, init to buffer size)\n  semaphore full = 0 (counting)\n\n  Producer: wait(empty); wait(mutex); [add item]; signal(mutex); signal(full)\n  Consumer: wait(full); wait(mutex); [remove item]; signal(mutex); signal(empty)",
                "(c) Priority inversion: a high-priority task is indirectly blocked by a low-priority task holding a resource it needs, while medium-priority tasks preempt the low-priority task. Mitigation: priority inheritance protocol - temporarily raise the low-priority task's priority to that of the highest-priority task waiting for its resource.",
            ]
        },
    ])

    make_pdf("Quiz_Solutions/final_solutions.pdf", "Final Exam - Solutions", [
        {
            "heading": "CS 2XY3 Final Exam (Solutions)",
            "content": [
                "## Question 1 Solutions - Deadlocks",
                "(a) Four necessary conditions: (1) Mutual exclusion - at least one resource held in non-sharable mode. (2) Hold and wait - a process holds resources while waiting for others. (3) No preemption - resources cannot be forcibly taken. (4) Circular wait - a circular chain of processes each waiting for a resource held by the next.",
                "(b) Yes, there is a deadlock. Cycle: P1->R2->P2->R3->P3->R1->P1. P4 is not part of the cycle but is blocked waiting for R2 (held by P2 which is in the cycle).",
                "(c) Banker's Algorithm: requires (1) Max matrix - maximum demand of each process for each resource type. (2) Allocation matrix - current allocation. (3) Available vector - currently free instances of each resource. (4) Need matrix = Max - Allocation. The algorithm checks if granting a request leads to a safe state (a sequence exists where all processes can finish).",
                "## Question 2 Solutions - File Systems",
                "(a) Contiguous: Adv - fast sequential/random access. Disadv - external fragmentation, file growth is difficult. Linked: Adv - no external fragmentation, easy growth. Disadv - slow random access (must traverse list), pointer overhead. Indexed: Adv - fast random access, no external fragmentation. Disadv - index block overhead, limited max file size with single index.",
                "(b) Direct: 12 x 4 KB = 48 KB. Single-indirect: 1024 x 4 KB = 4 MB. Double-indirect: 1024 x 1024 x 4 KB = 4 GB. Triple-indirect: 1024^3 x 4 KB = 4 TB. Max file = 48 KB + 4 MB + 4 GB + 4 TB (approximately 4 TB).",
                "## Question 3 Solutions - Virtual Memory",
                "(a) Page fault process: (1) Trap to OS. (2) Save user registers/state. (3) Check if reference is valid. (4) Find a free frame (or select victim via replacement algorithm). (5) If victim is dirty, write it to disk. (6) Read desired page from disk into frame. (7) Update page table. (8) Restart the instruction.",
                "(b) Reference string 7,0,1,2,0,3,0,4,2,3,0,3,2 with 3 frames:\n  FIFO: 10 page faults.\n  LRU: 10 page faults.\n  (Detailed trace available upon request.)",
                "(c) Thrashing: a process spends more time paging (swapping pages in/out) than executing. Caused by: too many processes competing for limited frames, so each process has fewer frames than its working set requires. Each page-in causes another page-out of a page that will be needed soon.",
            ]
        },
    ])

    print("\nAll demo PDFs generated successfully!")
    print("These are synthetic, self-authored materials for demonstration purposes.")


if __name__ == "__main__":
    main()
